/**
 * KernelCallbackManager — enumerate, disable, and restore kernel-mode
 * notification callbacks via kernel R/W primitives (BYOVD or direct syscall).
 *
 * # Threat Model
 *
 * Anti-cheat systems register kernel callbacks that monitor:
 *   - Process creation (PsSetCreateProcessNotifyRoutine)
 *   - Thread creation (PsSetCreateThreadNotifyRoutine)
 *   - DLL/image loads (PsSetLoadImageNotifyRoutine)
 *   - Handle operations (ObRegisterCallbacks on PsProcessType/PsThreadType)
 *   - Registry operations (CmRegisterCallback)
 *
 * Even with BYOVD kernel R/W, these callbacks are continuously running.
 * They detect and block our process creation, handle duplication, and DLL
 * injection attempts. This module implements the "RealBlindingEDR" technique:
 *
 *   1. Enumerate kernel callback arrays via kernel R/W
 *   2. Zero out anti-cheat callback entries (save originals)
 *   3. Perform our operations while callbacks are disabled
 *   4. Restore original callbacks before cleanup
 *
 * # Safety
 *
 * - ONLY disables anti-cheat callbacks (filtered by driver description)
 * - NEVER touches Windows system callbacks (PROTECTED_DRIVER_PATTERNS)
 * - Watchdog timer auto-restores callbacks after N seconds if jshookmcp crashes
 * - Restore point is created before any modification
 *
 * # Prerequisites
 *
 * - Kernel R/W primitive (BYOVD driver loaded, or direct syscall R/W)
 * - Administrator privileges
 * - ntoskrnl.exe base address (from NtModuleEnumerator)
 *
 * @module byovd/KernelCallbackManager
 */

import { logger } from '@utils/logger';
import {
  CALLBACK_SIGNATURES,
  ANTICHEAT_DRIVER_PATTERNS,
  PROTECTED_DRIVER_PATTERNS,
} from './CallbackSignatures';
import type { KernelCallbackArray } from './CallbackSignatures';

// ── Types ──

/**
 * Abstract kernel memory interface — decouples the callback manager from
 * any specific R/W implementation (BYOVD driver, direct syscall, etc.).
 *
 * All read/write methods return Promises because kernel R/W primitives
 * (IOCTL-based, rate-limited) are inherently asynchronous.
 */
export interface KernelMemoryInterface {
  /** Read `size` bytes from kernel virtual address `address`. */
  readKernelMemory(address: bigint, size: number): Promise<Buffer>;

  /** Write `data` to kernel virtual address `address`. */
  writeKernelMemory(address: bigint, data: Buffer): Promise<void>;

  /** Read a uint64 (8-byte pointer) from kernel virtual address. */
  readPointer(address: bigint): Promise<bigint>;

  /** Write a uint64 (8-byte pointer) to kernel virtual address. */
  writePointer(address: bigint, value: bigint): Promise<void>;

  /** Read a uint32 from kernel virtual address. */
  readUint32(address: bigint): Promise<number>;

  /** Read a uint16 from kernel virtual address. */
  readUint16(address: bigint): Promise<number>;

  /** Check whether the kernel R/W primitive is currently active. */
  isActive(): boolean;

  /** Get the base address of ntoskrnl.exe in kernel space. */
  getKernelBase(): bigint;
}

/** A single callback entry found in a kernel callback array. */
export interface CallbackEntry {
  /** Which array this entry belongs to. */
  arrayName: string;

  /** Zero-based index within the array. */
  index: number;

  /** Kernel virtual address of the entry struct. */
  entryAddress: bigint;

  /** Kernel virtual address of the callback function pointer field. */
  callbackPtrAddress: bigint;

  /** Current callback function pointer value. */
  callbackFunction: bigint;

  /**
   * Driver description string extracted from the entry's UNICODE_STRING.
   * null if the array does not store description data or parsing failed.
   */
  driverDescription: string | null;

  /** Whether this callback belongs to a known anti-cheat driver. */
  isAntiCheat: boolean;

  /** Whether this callback belongs to a Windows system driver (protected). */
  isProtected: boolean;
}

/**
 * Filter criteria for selecting which callbacks to disable.
 * All fields are ANDed — only callbacks matching ALL non-null criteria are selected.
 */
export interface CallbackFilter {
  /** Only process callbacks targeting this array name. */
  arrayName?: string;

  /** Only callbacks whose driver description matches this pattern (case-insensitive substring). */
  driverPattern?: string;

  /** Only callbacks from anti-cheat drivers (pre-filtered by ANTICHEAT_DRIVER_PATTERNS). */
  onlyAntiCheat?: boolean;

  /** Maximum number of callbacks to disable (safety cap). */
  maxCallbacks?: number;
}

/**
 * A restore point capturing the state of disabled callbacks so they can be
 * restored later.
 */
export interface CallbackRestorePoint {
  /** When the restore point was created (unix ms). */
  timestamp: number;

  /** Each disabled callback's saved state. */
  entries: RestoredCallbackEntry[];

  /** Watchdog timer handle (if active). */
  watchdogTimer?: ReturnType<typeof setTimeout>;
}

/** A single callback entry that was disabled and can be restored. */
interface RestoredCallbackEntry {
  entry: CallbackEntry;
  /** Original callback function pointer (before zeroing). */
  originalValue: bigint;
}

/** A found callback array with its resolved kernel address. */
interface ResolvedCallbackArray {
  signature: KernelCallbackArray;
  arrayAddress: bigint;
}

// ── Constants ──

/** Default watchdog timeout — auto-restore callbacks after this many ms. */
const DEFAULT_WATCHDOG_MS = 30_000; // 30 seconds

/** Maximum number of callbacks that can be disabled in a single operation. */
const MAX_CALLBACKS_PER_OPERATION = 128;

/** Null pointer value used to disable callbacks (zero the function pointer). */
const NULL_POINTER = 0n;

/**
 * Minimum kernel-mode address on x64 Windows.
 * Any valid kernel callback pointer must be >= this value.
 * (User-mode addresses are in the 0x0000_0000_0000_0000 – 0x0000_7FFF_FFFF_FFFF range.)
 */
const KERNEL_ADDRESS_MIN = 0xffff800000000000n;

// ── Manager ──

export class KernelCallbackManager {
  private readonly kernel: KernelMemoryInterface;
  private readonly knownArrays: ResolvedCallbackArray[] = [];
  private activeRestorePoint: CallbackRestorePoint | null = null;
  private shutdownRegistered = false;

  constructor(kernel: KernelMemoryInterface) {
    this.kernel = kernel;
  }

  /**
   * Register process-level handlers to restore callbacks on graceful shutdown.
   *
   * WARNING: These handlers only fire on NORMAL process exit (SIGTERM, SIGINT,
   * clean exit).  A HARD crash (BSOD, EDR process kill, power loss) will NOT
   * trigger these — in that case the kernel callbacks remain disabled until
   * the next reboot.  This is an inherent limitation of in-process watchdog
   * timers.
   *
   * As a partial mitigation, call detectStaleDisables() after kernel R/W is
   * re-established on the next session to identify stale zeroed callbacks.
   */
  private registerProcessHandlers(): void {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    const restore = () => {
      if (this.activeRestorePoint) {
        logger.warn('[KernelCallbackManager] Auto-restoring callbacks on process exit');
        try {
          this.restoreCallbacksSilent(this.activeRestorePoint);
        } catch (err) {
          logger.error(`[KernelCallbackManager] Shutdown restore failed: ${String(err)}`);
        }
      }
    };

    process.on('exit', restore);
    process.on('SIGTERM', restore);
    process.on('SIGINT', restore);
  }

  // ── Public API ──

  /**
   * Resolve all known callback array addresses by scanning ntoskrnl.exe.
   *
   * This must be called once before enumerateCallbacks() or disableCallbacks().
   * It reads the PE export table for exported symbols and pattern-scans
   * anchor functions for LEA-based resolution.
   *
   * Returns the count of successfully resolved arrays.
   */
  async resolveArrays(): Promise<number> {
    if (!this.kernel.isActive()) {
      throw new Error('Kernel R/W primitive is not active — load a BYOVD driver first');
    }

    const kernelBase = this.kernel.getKernelBase();
    this.knownArrays.length = 0;

    for (const sig of CALLBACK_SIGNATURES) {
      const arrayAddr = await this.resolveArray(sig, kernelBase);
      if (arrayAddr !== null) {
        this.knownArrays.push({ signature: sig, arrayAddress: arrayAddr });
        logger.debug(`[KernelCallbackManager] Resolved ${sig.name} @ 0x${arrayAddr.toString(16)}`);
      } else {
        logger.warn(`[KernelCallbackManager] Failed to resolve ${sig.name}`);
      }
    }

    return this.knownArrays.length;
  }

  /**
   * Enumerate all registered callbacks across all resolved arrays.
   *
   * Returns the full list of callback entries with metadata:
   * driver description, anti-cheat classification, and protection status.
   */
  async enumerateCallbacks(): Promise<CallbackEntry[]> {
    this.ensureArraysResolved();

    const entries: CallbackEntry[] = [];

    for (const { signature, arrayAddress } of this.knownArrays) {
      try {
        const arrayEntries = await this.readArrayEntries(signature, arrayAddress);
        entries.push(...arrayEntries);
      } catch (err) {
        logger.warn(`[KernelCallbackManager] Error reading ${signature.name}: ${String(err)}`);
      }
    }

    return entries;
  }

  /**
   * Temporarily disable specific kernel callbacks.
   *
   * Saves the original callback function pointers to a restore point,
   * then writes NULL (0) to each matching callback's function pointer field.
   *
   * The filter determines which callbacks to disable:
   *   - `onlyAntiCheat: true` → only anti-cheat driver callbacks
   *   - `arrayName: "PsProcessType.CallbackList"` → only handle callbacks
   *   - `maxCallbacks: 8` → cap at 8 callbacks
   *
   * Returns the restore point, which must be passed to restoreCallbacks().
   *
   * Safety guarantees:
   *   - Windows system callbacks (PROTECTED_DRIVER_PATTERNS) are NEVER disabled
   *   - A watchdog timer is started (default 30s) for auto-restore
   *   - Only one restore point can be active at a time
   */
  async disableCallbacks(
    filter: CallbackFilter = {},
    watchdogMs: number = DEFAULT_WATCHDOG_MS,
  ): Promise<CallbackRestorePoint> {
    this.ensureArraysResolved();

    if (this.activeRestorePoint !== null) {
      throw new Error('A restore point is already active — call restoreCallbacks() first');
    }

    const allEntries = await this.enumerateCallbacks();
    const maxCallbacks = filter.maxCallbacks ?? MAX_CALLBACKS_PER_OPERATION;

    // Filter and validate
    const targets = this.selectTargets(allEntries, filter, maxCallbacks);

    if (targets.length === 0) {
      throw new Error('No callbacks matched the filter criteria');
    }

    // Register process-level shutdown handlers for graceful restore
    this.registerProcessHandlers();

    // Create restore point with saved state
    const restoredEntries: RestoredCallbackEntry[] = [];

    for (const entry of targets) {
      // Re-read the current value (paranoid — in case it changed)
      const currentValue = await this.kernel.readPointer(entry.callbackPtrAddress);

      // Safety: verify the pointer is in kernel address range before writing.
      // A wrong callbackOffset would compute a garbage address — writing NULL
      // there would corrupt arbitrary kernel memory.
      if (currentValue !== NULL_POINTER && currentValue < KERNEL_ADDRESS_MIN) {
        logger.warn(
          `[KernelCallbackManager] SKIPPING ${entry.arrayName}[${entry.index}]: ` +
            `callback pointer 0x${currentValue.toString(16)} is not in kernel address range ` +
            `(min: 0x${KERNEL_ADDRESS_MIN.toString(16)}). ` +
            'This is likely an incorrect callbackOffset — verify the offset for your Windows build.',
        );
        continue;
      }

      if (currentValue === NULL_POINTER) {
        logger.warn(
          `[KernelCallbackManager] SKIPPING ${entry.arrayName}[${entry.index}]: ` +
            'callback pointer is already NULL. ' +
            'This may be a stale disable from a previous crashed session.',
        );
        continue;
      }

      restoredEntries.push({
        entry,
        originalValue: currentValue,
      });

      // Write NULL to disable the callback
      await this.kernel.writePointer(entry.callbackPtrAddress, NULL_POINTER);

      logger.info(
        `[KernelCallbackManager] Disabled ${entry.arrayName}[${entry.index}] ` +
          `(driver: ${entry.driverDescription ?? 'unknown'}, ` +
          `was: 0x${currentValue.toString(16)})`,
      );
    }

    if (restoredEntries.length === 0) {
      throw new Error(
        'All target callbacks failed address-range verification. ' +
          'The callback offsets may be incorrect for this Windows build. ' +
          'Check the logs for skipped entries and verify the offsets in CallbackSignatures.',
      );
    }

    const restorePoint: CallbackRestorePoint = {
      timestamp: Date.now(),
      entries: restoredEntries,
    };

    // Start watchdog timer
    if (watchdogMs > 0) {
      restorePoint.watchdogTimer = setTimeout(() => {
        logger.warn(
          '[KernelCallbackManager] WATCHDOG: auto-restoring callbacks ' +
            `after ${watchdogMs}ms timeout`,
        );
        this.restoreCallbacksSilent(restorePoint);
      }, watchdogMs);
    }

    this.activeRestorePoint = restorePoint;
    return restorePoint;
  }

  /**
   * Restore previously disabled callbacks.
   *
   * Writes the original callback function pointers back to each entry.
   * Cancels the watchdog timer if active.
   *
   * This is idempotent — calling it twice on the same restore point is safe
   * (the second call is a no-op because values are already restored).
   */
  async restoreCallbacks(restorePoint: CallbackRestorePoint): Promise<void> {
    await this.restoreCallbacksSilent(restorePoint);
    logger.info(`[KernelCallbackManager] Restored ${restorePoint.entries.length} callback(s)`);
  }

  /**
   * Permanently remove a specific callback entry from its array.
   *
   * This unlinks the entry from the callback list (for LIST_ENTRY-based
   * arrays) or zeros it out (for fixed arrays). This is DANGEROUS:
   * the driver that registered the callback may crash if it later tries
   * to unregister. Prefer disableCallbacks()/restoreCallbacks() instead.
   *
   * Only call this for anti-cheat callbacks that you are certain you want
   * permanently removed.
   */
  async removeCallback(entry: CallbackEntry): Promise<void> {
    this.ensureArraysResolved();

    if (entry.isProtected) {
      throw new Error(
        `Refusing to remove protected callback: ${entry.arrayName}[${entry.index}] ` +
          `(driver: ${entry.driverDescription ?? 'unknown'})`,
      );
    }

    const sig = this.knownArrays.find((a) => a.signature.name === entry.arrayName);
    if (!sig) {
      throw new Error(`Unknown callback array: ${entry.arrayName}`);
    }

    if (sig.signature.structureType === 'function_pointer_array') {
      // Fixed array: zero the entry
      await this.kernel.writePointer(entry.callbackPtrAddress, NULL_POINTER);
    } else {
      // Linked list: unlink the entry
      await this.unlinkCallbackEntry(entry);
    }

    logger.warn(
      `[KernelCallbackManager] PERMANENTLY removed callback: ` +
        `${entry.arrayName}[${entry.index}] ` +
        `(driver: ${entry.driverDescription ?? 'unknown'})`,
    );
  }

  /**
   * Check whether a restore point is currently active.
   */
  hasActiveRestorePoint(): boolean {
    return this.activeRestorePoint !== null;
  }

  /**
   * Get the current active restore point, or null.
   */
  getActiveRestorePoint(): CallbackRestorePoint | null {
    return this.activeRestorePoint;
  }

  /**
   * Get the list of resolved callback arrays (for diagnostics).
   */
  getResolvedArrays(): ReadonlyArray<{ name: string; address: bigint }> {
    return this.knownArrays.map((a) => ({
      name: a.signature.name,
      address: a.arrayAddress,
    }));
  }

  /**
   * Scan for stale (zeroed) callback entries that may have been left disabled
   * by a previous crashed session.
   *
   * When the MCP server crashes, the watchdog setTimeout does not fire and
   * callbacks remain zeroed in kernel memory.  This method scans resolved
   * arrays for anti-cheat callbacks whose function pointer is NULL and logs
   * warnings.  The original values are lost — the user must reboot to restore
   * them, or re-register the callbacks manually.
   *
   * Call this AFTER resolveArrays() and AFTER the kernel R/W primitive is
   * confirmed active.
   *
   * @returns Array of stale callback entries found (zeroed anti-cheat pointers).
   */
  async detectStaleDisables(): Promise<CallbackEntry[]> {
    this.ensureArraysResolved();

    const staleEntries: CallbackEntry[] = [];

    for (const { signature, arrayAddress } of this.knownArrays) {
      try {
        const entries = await this.readArrayEntries(signature, arrayAddress);
        for (const entry of entries) {
          // Check if the callback pointer is NULL (was zeroed but not restored)
          if (entry.callbackFunction === NULL_POINTER) {
            staleEntries.push(entry);
          }
        }
      } catch (err) {
        logger.debug(
          `[KernelCallbackManager] Stale-scan error for ${signature.name}: ${String(err)}`,
        );
      }
    }

    if (staleEntries.length > 0) {
      logger.warn(
        `[KernelCallbackManager] Found ${staleEntries.length} stale (zeroed) callback(s) ` +
          'from a likely crashed previous session:\n' +
          staleEntries
            .map(
              (e) =>
                `  ${e.arrayName}[${e.index}] driver=${e.driverDescription ?? 'unknown'} ` +
                `callback=0x${e.callbackFunction.toString(16)}`,
            )
            .join('\n') +
          '\nThese callbacks were disabled and NOT restored. ' +
          'Original values are lost — reboot to restore kernel callback state.',
      );
    }

    return staleEntries;
  }

  // ── Private: Array Resolution ──

  private async resolveArray(sig: KernelCallbackArray, kernelBase: bigint): Promise<bigint | null> {
    try {
      switch (sig.resolutionMethod) {
        case 'export':
          return await this.resolveViaExport(sig, kernelBase);
        case 'lea_rip':
          return await this.resolveViaLeaRip(sig, kernelBase);
        case 'offset':
          return await this.resolveViaOffset(sig, kernelBase);
        default:
          return null;
      }
    } catch (err) {
      logger.debug(`[KernelCallbackManager] Resolution failed for ${sig.name}: ${String(err)}`);
      return null;
    }
  }

  /**
   * Resolve an exported symbol's address by parsing ntoskrnl.exe's PE export table.
   *
   * PE export table layout (offset from DOS header → PE header → optional header → data directory):
   *   IMAGE_EXPORT_DIRECTORY:
   *     +0x00  Characteristics       (4 bytes)
   *     +0x04  TimeDateStamp          (4 bytes)
   *     +0x08  MajorVersion           (2 bytes)
   *     +0x0A  MinorVersion           (2 bytes)
   *     +0x0C  Name                   (4 bytes, RVA to DLL name string)
   *     +0x10  Base                   (4 bytes, ordinal base)
   *     +0x14  NumberOfFunctions      (4 bytes)
   *     +0x18  NumberOfNames          (4 bytes)
   *     +0x1C  AddressOfFunctions     (4 bytes, RVA to function RVA array)
   *     +0x20  AddressOfNames         (4 bytes, RVA to name RVA array)
   *     +0x24  AddressOfNameOrdinals  (4 bytes, RVA to ordinal array, uint16 each)
   */
  private async resolveViaExport(
    sig: KernelCallbackArray,
    kernelBase: bigint,
  ): Promise<bigint | null> {
    const symbolName = sig.exportedSymbol;
    if (!symbolName) return null;

    // Read DOS header → e_lfanew
    const dosHeader = await this.kernel.readKernelMemory(kernelBase, 64);
    const eLfanew = dosHeader.readUInt32LE(0x3c);

    // Read PE signature + COFF header
    const ntHeaders = await this.kernel.readKernelMemory(kernelBase + BigInt(eLfanew), 264);
    // PE signature "PE\0\0"
    const peSig = ntHeaders.readUInt32LE(0);
    if (peSig !== 0x00004550) {
      throw new Error('Invalid PE signature in kernel image');
    }

    // Optional header magic (PE32+ = 0x020B at offset 24 from PE sig)
    const optMagic = ntHeaders.readUInt16LE(24);
    const isPE32Plus = optMagic === 0x020b;

    // Data directory: 16 entries of {RVA, Size} at offset 96 (PE32) or 112 (PE32+)
    const ddOffset = isPE32Plus ? 136 : 120;
    // Export directory = entry 0: RVA at ddOffset, Size at ddOffset+4
    const exportRva = ntHeaders.readUInt32LE(ddOffset);
    if (exportRva === 0) {
      throw new Error('No export directory in kernel image');
    }

    return this.findExportByName(kernelBase, exportRva, symbolName);
  }

  /**
   * Binary search the export name table for a specific symbol and return its RVA.
   */
  private async findExportByName(
    kernelBase: bigint,
    exportRva: number,
    targetName: string,
  ): Promise<bigint | null> {
    // Read IMAGE_EXPORT_DIRECTORY (40 bytes)
    const exportDir = await this.kernel.readKernelMemory(kernelBase + BigInt(exportRva), 40);

    // numberOfFunctions at offset 0x14 — read but not needed for lookup
    exportDir.readUInt32LE(0x14);
    const numberOfNames = exportDir.readUInt32LE(0x18);
    const addressOfFunctionsRva = exportDir.readUInt32LE(0x1c);
    const addressOfNamesRva = exportDir.readUInt32LE(0x20);
    const addressOfNameOrdinalsRva = exportDir.readUInt32LE(0x24);

    if (numberOfNames === 0) return null;

    // Read name RVAs
    const namesBase = kernelBase + BigInt(addressOfNamesRva);
    const nameRvas = await this.kernel.readKernelMemory(namesBase, numberOfNames * 4);

    // Linear scan — name table typically < 5000 entries
    for (let i = 0; i < numberOfNames; i++) {
      const nameRva = nameRvas.readUInt32LE(i * 4);
      const name = await this.readNullTerminatedString(kernelBase + BigInt(nameRva), 256);
      if (name === targetName) {
        // Found — read ordinal from ordinal table (uint16 each)
        const ordinalBase = kernelBase + BigInt(addressOfNameOrdinalsRva);
        const ordinalBuf = await this.kernel.readKernelMemory(ordinalBase + BigInt(i * 2), 2);
        const ordinal = ordinalBuf.readUInt16LE(0);

        // Read function RVA from function table
        const funcBase = kernelBase + BigInt(addressOfFunctionsRva);
        const funcBuf = await this.kernel.readKernelMemory(funcBase + BigInt(ordinal * 4), 4);
        const funcRva = funcBuf.readUInt32LE(0);

        return kernelBase + BigInt(funcRva);
      }
    }

    return null;
  }

  /**
   * Resolve an array address by pattern-scanning an anchor function for
   * a LEA instruction that loads the array address via RIP-relative addressing.
   *
   * Pattern: 48 8D 0D ?? ?? ?? ?? (lea rcx, [rip + disp32])
   * The array address = instruction_address + 7 + sign_extend(disp32)
   */
  private async resolveViaLeaRip(
    sig: KernelCallbackArray,
    kernelBase: bigint,
  ): Promise<bigint | null> {
    if (!sig.anchorSymbol || !sig.leaPattern) return null;

    // First resolve the anchor function address
    const anchorAddr = await this.resolveViaExport(
      {
        ...sig,
        resolutionMethod: 'export',
        exportedSymbol: sig.anchorSymbol,
      },
      kernelBase,
    );

    if (anchorAddr === null) return null;

    // Scan the anchor function for the LEA pattern
    // Typical function size: 64-512 bytes
    const scanSize = 512;
    const funcBytes = await this.kernel.readKernelMemory(anchorAddr, scanSize);

    const patternBytes = this.parsePattern(sig.leaPattern);
    const matchOffset = this.findPattern(funcBytes, patternBytes);

    if (matchOffset < 0) return null;

    // Extract displacement (the ?? ?? ?? ?? bytes)
    const dispOffset = this.findFirstWildcardOffset(sig.leaPattern);
    const disp = funcBytes.readInt32LE(matchOffset + dispOffset);

    // Compute absolute address: instruction_addr + 7 + displacement
    const instrAddr = anchorAddr + BigInt(matchOffset);
    const arrayAddr = instrAddr + 7n + BigInt(disp);

    return arrayAddr;
  }

  /**
   * Resolve an array at a known offset from an exported symbol.
   */
  private async resolveViaOffset(
    sig: KernelCallbackArray,
    kernelBase: bigint,
  ): Promise<bigint | null> {
    if (!sig.anchorSymbol || sig.knownOffset === undefined) return null;

    const symbolAddr = await this.resolveViaExport(
      {
        ...sig,
        resolutionMethod: 'export',
        exportedSymbol: sig.anchorSymbol,
      },
      kernelBase,
    );

    if (symbolAddr === null) return null;

    // For exported data symbols (like PsProcessType), the "address" from
    // the export table IS the data address, not a function. We just add the offset.
    // But some exports are pointers — dereference first.
    // PsProcessType is exported as the address of the OBJECT_TYPE structure itself,
    // so we read the pointer at the export address.
    const dereferenced = await this.kernel.readPointer(symbolAddr);

    return dereferenced + BigInt(sig.knownOffset);
  }

  // ── Private: Entry Reading ──

  private async readArrayEntries(
    sig: KernelCallbackArray,
    arrayAddress: bigint,
  ): Promise<CallbackEntry[]> {
    if (sig.structureType === 'ex_callback_routine_block') {
      return this.readExCallbackRoutineBlockArray(sig, arrayAddress);
    }
    if (sig.structureType === 'callback_entry_item') {
      return this.readCallbackEntryItemList(sig, arrayAddress);
    }
    return this.readFunctionPointerArray(sig, arrayAddress);
  }

  /**
   * Read a fixed-size array of EX_CALLBACK_ROUTINE_BLOCK structures.
   *
   * Each entry:
   *   +0x00  LIST_ENTRY  (Flink, Blink — 8 bytes each on x64)
   *   +0x10  CallbackRoutine (function pointer)
   */
  private async readExCallbackRoutineBlockArray(
    sig: KernelCallbackArray,
    arrayAddress: bigint,
  ): Promise<CallbackEntry[]> {
    const entries: CallbackEntry[] = [];

    for (let i = 0; i < sig.maxEntries; i++) {
      const entryAddr = arrayAddress + BigInt(i * sig.entrySize);

      // Read LIST_ENTRY.Flink — if null, this slot is empty
      const flink = await this.kernel.readPointer(entryAddr);
      if (flink === NULL_POINTER) continue;

      const callbackPtrAddr = entryAddr + BigInt(sig.callbackOffset);
      const callbackFn = await this.kernel.readPointer(callbackPtrAddr);

      // Empty slot: both Flink and callback are null
      if (callbackFn === NULL_POINTER) continue;

      entries.push({
        arrayName: sig.name,
        index: i,
        entryAddress: entryAddr,
        callbackPtrAddress: callbackPtrAddr,
        callbackFunction: callbackFn,
        driverDescription: null, // EX_CALLBACK_ROUTINE_BLOCK has no driver description
        isAntiCheat: false, // Cannot determine without description
        isProtected: false,
      });
    }

    return entries;
  }

  /**
   * Walk a linked list of CALLBACK_ENTRY_ITEM structures.
   *
   * This handles PsProcessType.CallbackList and PsThreadType.CallbackList
   * (ObRegisterCallbacks callbacks). The list head is at the resolved array
   * address; we follow Flink pointers until we loop back to the head.
   *
   * CALLBACK_ENTRY_ITEM layout (approximate, Windows version dependent):
   *   +0x00  LIST_ENTRY
   *   +0x10  (various fields)
   *   +0x28  CallbackRoutine (function pointer)
   *   +0x50  DriverName (UNICODE_STRING — USHORT Length, USHORT MaxLength, PVOID Buffer)
   */
  private async readCallbackEntryItemList(
    sig: KernelCallbackArray,
    arrayAddress: bigint,
  ): Promise<CallbackEntry[]> {
    const entries: CallbackEntry[] = [];
    const maxEntries = 256; // Safety cap for linked list traversal

    // Read the list head
    let currentFlink = await this.kernel.readPointer(arrayAddress);
    const listHead = arrayAddress;
    let count = 0;

    while (currentFlink !== NULL_POINTER && currentFlink !== listHead && count < maxEntries) {
      // currentFlink points to the LIST_ENTRY within a CALLBACK_ENTRY_ITEM.
      // The callback entry starts at LIST_ENTRY offset (0), so currentFlink
      // IS the entry address (since LIST_ENTRY is at offset 0).
      const entryAddr = currentFlink;
      const callbackPtrAddr = entryAddr + BigInt(sig.callbackOffset);
      const callbackFn = await this.kernel.readPointer(callbackPtrAddr);

      // Extract driver description UNICODE_STRING
      let driverDesc: string | null = null;
      if (sig.descriptionOffset !== undefined) {
        driverDesc = await this.readUnicodeString(entryAddr + BigInt(sig.descriptionOffset));
      }

      // Classify callback
      const isAntiCheat = this.matchesAntiCheat(driverDesc);
      const isProtected = this.matchesProtected(driverDesc);

      if (callbackFn !== NULL_POINTER) {
        entries.push({
          arrayName: sig.name,
          index: count,
          entryAddress: entryAddr,
          callbackPtrAddress: callbackPtrAddr,
          callbackFunction: callbackFn,
          driverDescription: driverDesc,
          isAntiCheat,
          isProtected,
        });
      }

      // Follow Flink to next entry
      currentFlink = await this.kernel.readPointer(entryAddr);
      count++;
    }

    return entries;
  }

  /**
   * Read a simple array of function pointers (not wrapped in structs).
   */
  private async readFunctionPointerArray(
    sig: KernelCallbackArray,
    arrayAddress: bigint,
  ): Promise<CallbackEntry[]> {
    const entries: CallbackEntry[] = [];

    for (let i = 0; i < sig.maxEntries; i++) {
      const callbackPtrAddr = arrayAddress + BigInt(i * 8); // 8-byte pointer per slot
      const callbackFn = await this.kernel.readPointer(callbackPtrAddr);

      if (callbackFn === NULL_POINTER) continue;

      entries.push({
        arrayName: sig.name,
        index: i,
        entryAddress: callbackPtrAddr, // The array slot itself
        callbackPtrAddress: callbackPtrAddr,
        callbackFunction: callbackFn,
        driverDescription: null,
        isAntiCheat: false,
        isProtected: false,
      });
    }

    return entries;
  }

  // ── Private: Selection & Filtering ──

  private selectTargets(
    allEntries: CallbackEntry[],
    filter: CallbackFilter,
    maxCallbacks: number,
  ): CallbackEntry[] {
    let candidates = allEntries;

    // Filter by array name
    if (filter.arrayName) {
      candidates = candidates.filter((e) => e.arrayName === filter.arrayName);
    }

    // Filter by driver pattern
    if (filter.driverPattern) {
      const pat = filter.driverPattern.toLowerCase();
      candidates = candidates.filter((e) => e.driverDescription?.toLowerCase().includes(pat));
    }

    // Filter to anti-cheat only
    if (filter.onlyAntiCheat) {
      candidates = candidates.filter((e) => e.isAntiCheat);
    }

    // Remove protected (Windows system) callbacks — safety gate
    candidates = candidates.filter((e) => !e.isProtected);

    // Cap at max
    if (candidates.length > maxCallbacks) {
      logger.warn(
        `[KernelCallbackManager] Truncating ${candidates.length} matches ` +
          `to ${maxCallbacks} (maxCallbacks limit)`,
      );
      candidates = candidates.slice(0, maxCallbacks);
    }

    return candidates;
  }

  // ── Private: Restore Logic ──

  private async restoreCallbacksSilent(restorePoint: CallbackRestorePoint): Promise<void> {
    // Cancel watchdog
    if (restorePoint.watchdogTimer) {
      clearTimeout(restorePoint.watchdogTimer);
      restorePoint.watchdogTimer = undefined;
    }

    // Restore each callback
    for (const { entry, originalValue } of restorePoint.entries) {
      try {
        await this.kernel.writePointer(entry.callbackPtrAddress, originalValue);
      } catch (err) {
        logger.error(
          `[KernelCallbackManager] Failed to restore ${entry.arrayName}[${entry.index}]: ` +
            String(err),
        );
      }
    }

    // Clear active restore point
    if (this.activeRestorePoint === restorePoint) {
      this.activeRestorePoint = null;
    }
  }

  /**
   * Unlink a callback entry from a doubly-linked list (LIST_ENTRY-based arrays).
   *
   * Reads the Flink and Blink pointers from the entry's LIST_ENTRY,
   * then patches Blink->Flink = Flink and Flink->Blink = Blink.
   * The unlinked entry is NOT freed — it just becomes unreachable.
   */
  private async unlinkCallbackEntry(entry: CallbackEntry): Promise<void> {
    // LIST_ENTRY is at offset 0 of the entry
    const flink = await this.kernel.readPointer(entry.entryAddress); // +0x00
    const blink = await this.kernel.readPointer(entry.entryAddress + 8n); // +0x08

    // Blink->Flink = Flink
    await this.kernel.writePointer(blink, flink);

    // Flink->Blink = Blink
    await this.kernel.writePointer(flink + 8n, blink);

    // Zero the unlinked entry's pointers (paranoid cleanup)
    await this.kernel.writePointer(entry.entryAddress, NULL_POINTER);
    await this.kernel.writePointer(entry.entryAddress + 8n, NULL_POINTER);
    await this.kernel.writePointer(entry.callbackPtrAddress, NULL_POINTER);
  }

  // ── Private: Utilities ──

  private ensureArraysResolved(): void {
    if (!this.kernel.isActive()) {
      throw new Error('Kernel R/W primitive is not active — load a BYOVD driver first');
    }
    if (this.knownArrays.length === 0) {
      throw new Error('No callback arrays resolved — call resolveArrays() first');
    }
  }

  private matchesAntiCheat(description: string | null): boolean {
    if (!description) return false;
    const lower = description.toLowerCase();
    return ANTICHEAT_DRIVER_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
  }

  private matchesProtected(description: string | null): boolean {
    if (!description) return false;
    const lower = description.toLowerCase();
    return PROTECTED_DRIVER_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
  }

  /**
   * Read a null-terminated ASCII/UTF-8 string from kernel memory.
   */
  private async readNullTerminatedString(address: bigint, maxLen: number): Promise<string> {
    const buf = await this.kernel.readKernelMemory(address, maxLen);
    let end = 0;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('utf8', 0, end);
  }

  /**
   * Read a UNICODE_STRING from kernel memory.
   *
   * UNICODE_STRING layout:
   *   +0x00  Length    (USHORT — bytes, not characters)
   *   +0x02  MaximumLength (USHORT)
   *   +0x08  Buffer    (PWSTR — pointer to UTF-16LE string)
   */
  private async readUnicodeString(addr: bigint): Promise<string | null> {
    try {
      const header = await this.kernel.readKernelMemory(addr, 16);
      const length = header.readUInt16LE(0);
      const maxLength = header.readUInt16LE(2);
      // Padding bytes at +4, pointer at +8
      const bufferPtr = header.readBigUInt64LE(8);

      if (bufferPtr === NULL_POINTER || length === 0) return null;
      if (length > maxLength + 2 || length > 512) return null; // sanity check

      const utf16Bytes = await this.kernel.readKernelMemory(bufferPtr, length);
      // Convert UTF-16LE to string
      const chars: number[] = [];
      for (let i = 0; i + 1 < utf16Bytes.length; i += 2) {
        const codeUnit = utf16Bytes.readUInt16LE(i);
        if (codeUnit === 0) break;
        chars.push(codeUnit);
      }
      return String.fromCharCode(...chars);
    } catch {
      return null;
    }
  }

  /**
   * Parse a space-separated hex pattern string ("48 8D 0D ?? ?? ?? ??") into
   * a byte array where wildcard bytes (??) are 0x00.
   */
  private parsePattern(pattern: string): Buffer {
    const bytes: number[] = [];
    for (const token of pattern.split(/\s+/)) {
      if (token === '??') {
        bytes.push(0x00);
      } else {
        bytes.push(parseInt(token, 16));
      }
    }
    return Buffer.from(bytes);
  }

  /**
   * Find a pattern in a buffer using simple byte scanning.
   * Wildcard bytes (0x00 in the pattern) match any source byte.
   * Returns the offset of the first match, or -1 if not found.
   */
  private findPattern(source: Buffer, pattern: Buffer): number {
    const sourceLen = source.length;
    const patLen = pattern.length;

    if (patLen === 0 || sourceLen < patLen) return -1;

    for (let i = 0; i <= sourceLen - patLen; i++) {
      let match = true;
      for (let j = 0; j < patLen; j++) {
        if (pattern[j] === 0x00) continue; // wildcard
        if (source[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }

    return -1;
  }

  /**
   * Find the offset of the first wildcard (??) in a pattern string.
   */
  private findFirstWildcardOffset(pattern: string): number {
    const tokens = pattern.split(/\s+/);
    let byteOffset = 0;
    for (const token of tokens) {
      if (token === '??') return byteOffset;
      byteOffset++;
    }
    return 0;
  }

  // ── Static Factory ──

  /**
   * Create a KernelCallbackManager wired to an active ByovdManager.
   *
   * The ByovdManager provides physical memory R/W via the loaded
   * vulnerable driver. This factory builds a KernelMemoryInterface
   * that translates kernel virtual addresses to physical addresses
   * via page-table walk, then reads/writes physical memory through
   * the driver's IOCTL interface.
   *
   * Requirements:
   *   - BYOVD physical-memory driver must be loaded (isActive() === true)
   *   - The driver must support physical memory access
   *   - Administrator privileges
   *
   * On first use, the kernel PML4 (page-table base) is auto-resolved
   * by scanning low physical memory for a self-referencing PML4 entry.
   */
  static async createForByovd(
    byovdManager: import('./ByovdManager').ByovdManager,
  ): Promise<KernelCallbackManager> {
    const kernel: KernelMemoryInterface = createByovdKernelInterface(byovdManager);
    return new KernelCallbackManager(kernel);
  }
}

// ── ByovdManager → KernelMemoryInterface Adapter ──

/**
 * PAGE_TABLE_ENTRY flags for x64 page table entries.
 */
const PTE_PRESENT = 1n << 0n;
const PTE_PS = 1n << 7n; // large page (2MB at PD level, 1GB at PDPT level)
const PTE_PFN_MASK = 0x0000fffffffff000n; // bits 51:12

/** PML4 self-reference entry index on Windows 8+ x64. */
const PML4_SELF_REF_INDEX = 0x1ed;

/** Maximum physical memory to scan for PML4 auto-detection (16 MB). */
const PML4_SCAN_MAX = 16 * 1024 * 1024;

/**
 * Build a KernelMemoryInterface from a ByovdManager.
 *
 * The adapter translates kernel virtual addresses to physical addresses
 * by walking the x64 4-level page table. The kernel PML4 (DirectoryTableBase)
 * is resolved once on first translation via a self-reference-entry scan of
 * low physical memory.
 */
function createByovdKernelInterface(
  byovdManager: import('./ByovdManager').ByovdManager,
): KernelMemoryInterface {
  let kernelBaseCache: bigint | null = null;
  let pml4PhysicalCache: bigint | null = null;
  let pml4ResolvedFlag = false;

  /**
   * Resolve the kernel PML4 physical address by scanning low physical
   * memory for a self-referencing PML4 entry.
   *
   * On x64 Windows 8+, PML4[0x1ED] contains a self-reference: its PFN
   * points back to the PML4 table's own physical page.
   *
   * Scan strategy (optimized):
   *   For each page-aligned address in [0x1000, PML4_SCAN_MAX):
   *     Read the single 8-byte self-reference entry (PML4[0x1ED]).
   *     If the PFN in that entry equals the current scan address,
   *     this page is the kernel PML4.
   *
   * This reads only 8 bytes per candidate page — one IOCTL call each.
   * At 100 IOCTL/sec and 4095 candidate pages in 16MB, worst case is
   * ~41 seconds. In practice the PML4 is almost always within the
   * first 128 KB, finishing in <2 seconds.
   */
  async function resolvePml4(): Promise<bigint> {
    for (let addr = 0x1000n; addr < BigInt(PML4_SCAN_MAX); addr += 0x1000n) {
      const result = await byovdManager.readPhysicalMemory(
        addr + BigInt(PML4_SELF_REF_INDEX * 8),
        8,
      );
      if (!result.success || !result.data || result.bytesRead < 8) continue;

      const entry = result.data.readBigUInt64LE(0);
      // Check if entry is present and self-referencing
      if ((entry & PTE_PRESENT) === 0n) continue;
      const pfn = entry & PTE_PFN_MASK;
      if (pfn === (addr & PTE_PFN_MASK)) {
        return addr;
      }
    }

    throw new Error(
      'Could not auto-resolve kernel PML4 in first 16MB of physical memory. ' +
        'The BYOVD driver may not support physical memory access, or the PML4 ' +
        'is at an unexpected location.',
    );
  }

  /** Walk the x64 4-level page table to translate kernel VA to PA. */
  async function translateKernelVa(va: bigint): Promise<bigint> {
    if (!pml4ResolvedFlag) {
      pml4PhysicalCache = await resolvePml4();
      pml4ResolvedFlag = true;
    }
    const pml4 = pml4PhysicalCache!;

    const pml4Index = Number((va >> 39n) & 0x1ffn);
    const pdptIndex = Number((va >> 30n) & 0x1ffn);
    const pdIndex = Number((va >> 21n) & 0x1ffn);
    const ptIndex = Number((va >> 12n) & 0x1ffn);
    const offset = va & 0xfffn;

    // Read PML4 entry
    const pml4eAddr = pml4 + BigInt(pml4Index * 8);
    const pml4eRes = await byovdManager.readPhysicalMemory(pml4eAddr, 8);
    if (!pml4eRes.success || !pml4eRes.data || pml4eRes.bytesRead < 8) {
      throw new Error(`Failed to read PML4E at index ${pml4Index}`);
    }
    const pml4e = pml4eRes.data.readBigUInt64LE(0);
    if ((pml4e & PTE_PRESENT) === 0n) {
      throw new Error(`PML4E[${pml4Index}] not present for VA 0x${va.toString(16)}`);
    }

    // Read PDPT entry
    const pdptBase = pml4e & PTE_PFN_MASK;
    const pdpteAddr = pdptBase + BigInt(pdptIndex * 8);
    const pdpteRes = await byovdManager.readPhysicalMemory(pdpteAddr, 8);
    if (!pdpteRes.success || !pdpteRes.data || pdpteRes.bytesRead < 8) {
      throw new Error(`Failed to read PDPTE at index ${pdptIndex}`);
    }
    const pdpte = pdpteRes.data.readBigUInt64LE(0);
    if ((pdpte & PTE_PRESENT) === 0n) {
      throw new Error(`PDPTE[${pdptIndex}] not present for VA 0x${va.toString(16)}`);
    }

    // Check for 1GB large page
    if ((pdpte & PTE_PS) !== 0n) {
      return (pdpte & PTE_PFN_MASK) + offset;
    }

    // Read PD entry
    const pdBase = pdpte & PTE_PFN_MASK;
    const pdeAddr = pdBase + BigInt(pdIndex * 8);
    const pdeRes = await byovdManager.readPhysicalMemory(pdeAddr, 8);
    if (!pdeRes.success || !pdeRes.data || pdeRes.bytesRead < 8) {
      throw new Error(`Failed to read PDE at index ${pdIndex}`);
    }
    const pde = pdeRes.data.readBigUInt64LE(0);
    if ((pde & PTE_PRESENT) === 0n) {
      throw new Error(`PDE[${pdIndex}] not present for VA 0x${va.toString(16)}`);
    }

    // Check for 2MB large page
    if ((pde & PTE_PS) !== 0n) {
      return (pde & PTE_PFN_MASK) + (va & 0x1fffffn);
    }

    // Read PT entry
    const ptBase = pde & PTE_PFN_MASK;
    const pteAddr = ptBase + BigInt(ptIndex * 8);
    const pteRes = await byovdManager.readPhysicalMemory(pteAddr, 8);
    if (!pteRes.success || !pteRes.data || pteRes.bytesRead < 8) {
      throw new Error(`Failed to read PTE at index ${ptIndex}`);
    }
    const pte = pteRes.data.readBigUInt64LE(0);
    if ((pte & PTE_PRESENT) === 0n) {
      throw new Error(`PTE[${ptIndex}] not present for VA 0x${va.toString(16)}`);
    }

    return (pte & PTE_PFN_MASK) + offset;
  }

  /** Resolve ntoskrnl.exe kernel base address lazily. */
  async function resolveKernelBase(): Promise<bigint> {
    if (kernelBaseCache !== null) return kernelBaseCache;

    try {
      const { findKernelModule } = await import('@native/syscall/NtModuleEnumerator');
      const mod = findKernelModule('ntoskrnl.exe');
      if (!mod) {
        throw new Error('Could not find ntoskrnl.exe in kernel module list');
      }
      kernelBaseCache = mod.imageBase;
      return mod.imageBase;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const wrapped = new Error(`Failed to resolve ntoskrnl.exe base: ${msg}`);
      if (err instanceof Error) wrapped.cause = err;
      throw wrapped;
    }
  }

  return {
    isActive: () => byovdManager.isActive(),

    getKernelBase: () => {
      // Synchronous wrapper — the caller (resolveArrays) will call this
      // after confirming isActive(). We prime the cache lazily.
      if (kernelBaseCache !== null) return kernelBaseCache;
      // For the initial call, throw if not resolved yet.
      // resolveArrays() will catch this.
      throw new Error(
        'ntoskrnl.exe base not yet resolved. Ensure a physical-memory ' +
          'BYOVD driver is loaded and kernel PML4 is resolvable.',
      );
    },

    async readKernelMemory(address: bigint, size: number): Promise<Buffer> {
      // Resolve kernel base + PML4 on first call
      if (kernelBaseCache === null) {
        kernelBaseCache = await resolveKernelBase();
      }

      const result = Buffer.alloc(size);
      // Translate each 8-byte aligned chunk
      for (let offset = 0; offset < size; offset += 8) {
        const va = address + BigInt(offset);
        const pa = await translateKernelVa(va);
        const chunkSize = Math.min(8, size - offset);
        const readRes = await byovdManager.readPhysicalMemory(pa, chunkSize);
        if (!readRes.success || !readRes.data) {
          throw new Error(
            `Kernel read failed at VA 0x${va.toString(16)}: ${readRes.error ?? 'unknown'}`,
          );
        }
        readRes.data.copy(result, offset, 0, chunkSize);
      }

      return result;
    },

    async writeKernelMemory(address: bigint, data: Buffer): Promise<void> {
      if (kernelBaseCache === null) {
        kernelBaseCache = await resolveKernelBase();
      }

      for (let offset = 0; offset < data.length; offset += 8) {
        const va = address + BigInt(offset);
        const pa = await translateKernelVa(va);
        const chunk = data.subarray(offset, Math.min(offset + 8, data.length));
        const writeRes = await byovdManager.writePhysicalMemory(pa, chunk);
        if (!writeRes.success) {
          throw new Error(
            `Kernel write failed at VA 0x${va.toString(16)}: ${writeRes.error ?? 'unknown'}`,
          );
        }
      }
    },

    readPointer: async function (address: bigint): Promise<bigint> {
      const buf = await this.readKernelMemory(address, 8);
      return buf.readBigUInt64LE(0);
    },

    writePointer: async function (address: bigint, value: bigint): Promise<void> {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(value);
      await this.writeKernelMemory(address, buf);
    },

    readUint32: async function (address: bigint): Promise<number> {
      const buf = await this.readKernelMemory(address, 4);
      return buf.readUInt32LE(0);
    },

    readUint16: async function (address: bigint): Promise<number> {
      const buf = await this.readKernelMemory(address, 2);
      return buf.readUInt16LE(0);
    },
  };
}
