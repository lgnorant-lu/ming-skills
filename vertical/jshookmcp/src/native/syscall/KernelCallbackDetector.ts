/**
 * KernelCallbackDetector — detects kernel callbacks visible from user-mode.
 *
 * While most kernel callbacks (PsSetCreateProcessNotifyRoutine,
 * ObRegisterCallbacks) cannot be directly enumerated from user-mode without
 * a kernel driver (BYOVD), there are several indirect signals:
 *
 * 1. **Loaded driver enumeration** — NtQuerySystemInformation with
 *    SystemModuleInformation reveals all loaded kernel drivers. We match
 *    against known anti-cheat driver name patterns.
 *
 * 2. **Handle enumeration** — NtQuerySystemInformation with
 *    SystemHandleInformation reveals which processes have open handles to
 *    our process. EDR/AV typically holds PROCESS_ALL_ACCESS or
 *    PROCESS_VM_READ handles.
 *
 * 3. **Service enumeration** — Many anti-cheat drivers register as Windows
 *    services. We can enumerate services to detect their presence.
 *
 * 4. **ETW-TI provider check** — The Microsoft-Windows-Threat-Intelligence
 *    ETW provider GUID presence in active loggers is a strong signal that
 *    kernel threat intelligence is being consumed (likely by EDR).
 *
 * @module KernelCallbackDetector
 */

import { logger } from '@utils/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export interface KernelCallbackReport {
  /** Loaded drivers matching anti-cheat patterns. */
  detectedDrivers: DetectedDriver[];
  /** Processes with open handles to us (suspicious). */
  suspiciousHandles: SuspiciousHandle[];
  /** Active ETW trace sessions consuming kernel providers. */
  activeKernelTraceSessions: string[];
  /** Whether threat-intelligence ETW is likely active. */
  threatIntelEtwActive: boolean;
  /** Overall detection verdict. */
  verdict: 'clean' | 'suspicious' | 'hostile';
  /** Honest boundary notes about what cannot be detected from user-mode. */
  limitations: string[];
  /** Timestamp of the check. */
  checkedAt: number;
}

export interface DetectedDriver {
  /** Driver service/display name. */
  name: string;
  /** Matched anti-cheat pattern. */
  matchedPattern: string;
  /** Driver file path (if known). */
  path?: string;
  /** Category: anti-cheat, EDR, AV, unknown. */
  category: 'anti_cheat' | 'edr' | 'av' | 'unknown';
}

export interface SuspiciousHandle {
  /** Process ID that opened the handle. */
  pid: number;
  /** Process name (if resolvable). */
  processName?: string;
  /** Granted access mask. */
  accessMask: number;
  /** Human-readable access description. */
  accessDescription: string;
}

// ── Known Anti-Cheat / EDR Driver Patterns ───────────────────────────────────

const ANTICHEAT_DRIVER_PATTERNS: Array<{ pattern: string; category: DetectedDriver['category'] }> =
  [
    // Anti-cheat
    { pattern: 'EasyAntiCheat', category: 'anti_cheat' },
    { pattern: 'eac', category: 'anti_cheat' },
    { pattern: 'BEDaisy', category: 'anti_cheat' },
    { pattern: 'BattlEye', category: 'anti_cheat' },
    { pattern: 'vgk', category: 'anti_cheat' },
    { pattern: 'vanguard', category: 'anti_cheat' },
    { pattern: 'FACEIT', category: 'anti_cheat' },
    { pattern: 'ESEADriver', category: 'anti_cheat' },
    { pattern: 'PnkBstr', category: 'anti_cheat' },
    { pattern: 'equ8', category: 'anti_cheat' },
    { pattern: 'XignCode', category: 'anti_cheat' },
    { pattern: 'GameGuard', category: 'anti_cheat' },
    { pattern: 'GameMon', category: 'anti_cheat' },
    { pattern: 'NexonGameSecurity', category: 'anti_cheat' },
    { pattern: 'BlackCipher', category: 'anti_cheat' },
    { pattern: 'ACE-BASE', category: 'anti_cheat' },
    { pattern: 'ACE-CORE', category: 'anti_cheat' },
    { pattern: 'SGuard', category: 'anti_cheat' },
    { pattern: 'mrac', category: 'anti_cheat' },
    // EDR
    { pattern: 'CrowdStrike', category: 'edr' },
    { pattern: 'CSAgent', category: 'edr' },
    { pattern: 'SentinelOne', category: 'edr' },
    { pattern: 'S1Agent', category: 'edr' },
    { pattern: 'CarbonBlack', category: 'edr' },
    { pattern: 'CbDefense', category: 'edr' },
    { pattern: 'Cylance', category: 'edr' },
    { pattern: 'CyOptics', category: 'edr' },
    { pattern: 'Elastic', category: 'edr' },
    { pattern: 'ElasticEndpoint', category: 'edr' },
    // AV
    { pattern: 'WdFilter', category: 'av' },
    { pattern: 'WdNisDrv', category: 'av' },
    { pattern: 'MsMpEng', category: 'av' },
    { pattern: 'avast', category: 'av' },
    { pattern: 'avg', category: 'av' },
    { pattern: 'avira', category: 'av' },
    { pattern: 'bitdefender', category: 'av' },
    { pattern: 'kaspersky', category: 'av' },
    { pattern: 'mcafee', category: 'av' },
    { pattern: 'symantec', category: 'av' },
    { pattern: 'trendmicro', category: 'av' },
    { pattern: 'eset', category: 'av' },
    { pattern: 'sophos', category: 'av' },
  ];

// ── Dangerous handle access flags ────────────────────────────────────────────

/** Access flags that indicate a monitoring handle (AV/EDR). */
const MONITORING_ACCESS_FLAGS: Array<{ mask: number; description: string }> = [
  { mask: 0x0010, description: 'VM_READ' },
  { mask: 0x0008, description: 'VM_OPERATION' },
  { mask: 0x0020, description: 'VM_WRITE' },
  { mask: 0x0400, description: 'QUERY_INFORMATION' },
  { mask: 0x0800, description: 'SUSPEND_RESUME' },
  { mask: 0x0001, description: 'TERMINATE' },
  { mask: 0x0002, description: 'CREATE_THREAD' },
  { mask: 0x0040, description: 'DUP_HANDLE' },
];

function describeAccess(mask: number): string {
  const flags: string[] = [];
  for (const { mask: flag, description } of MONITORING_ACCESS_FLAGS) {
    if (mask & flag) flags.push(description);
  }
  return flags.length > 0 ? flags.join('|') : `0x${mask.toString(16)}`;
}

// ── Detection Functions ──────────────────────────────────────────────────────

/**
 * Detect anti-cheat / EDR / AV drivers by scanning loaded kernel modules.
 *
 * On Windows, uses NtQuerySystemInformation with SystemModuleInformation (class 11).
 * Falls back to shelling out to `driverquery` if koffi is unavailable.
 *
 * HONEST BOUNDARY: This detects LOADED drivers, not active callbacks.
 * A driver can be loaded without having an active callback, and some
 * callbacks can be registered without a visible driver (e.g. hypervisor-based).
 */
function detectDriversByModuleList(): { drivers: DetectedDriver[]; error?: string } {
  if (process.platform !== 'win32') {
    return { drivers: [] };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtQuerySystemInformation = ntdll.func(
      'int32 NtQuerySystemInformation(uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );

    // SystemModuleInformation = class 11
    const SYSTEM_MODULE_INFORMATION = 11;

    // First call to get required buffer size
    const sizeBuf = Buffer.alloc(4);
    let status = NtQuerySystemInformation(
      SYSTEM_MODULE_INFORMATION,
      null,
      0,
      koffi.address(sizeBuf),
    ) as number;

    // STATUS_INFO_LENGTH_MISMATCH = 0xC0000004 (expected on first call)
    const requiredSize = sizeBuf.readUInt32LE(0);
    if (requiredSize === 0 || requiredSize > 16 * 1024 * 1024) {
      try {
        ntdll.unload();
      } catch {
        /* ignore */
      }
      return { drivers: [], error: `Invalid buffer size: ${requiredSize}` };
    }

    const buf = Buffer.alloc(requiredSize + 4096); // extra margin
    status = NtQuerySystemInformation(
      SYSTEM_MODULE_INFORMATION,
      koffi.address(buf),
      buf.length,
      koffi.address(sizeBuf),
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    if (status < 0) {
      return {
        drivers: [],
        error: `NtQuerySystemInformation failed: 0x${(status >>> 0).toString(16)}`,
      };
    }

    // Parse SYSTEM_MODULE_INFORMATION:
    //   ULONG Count (offset 0)
    //   SYSTEM_MODULE[Count] starting at offset 8
    //   Each SYSTEM_MODULE (x64): Reserved(8) + ImageBase(8) + ImageSize(4) +
    //     Flags(4) + Index(2) + Unknown(2) + LoadCount(2) +
    //     ModuleNameOffset(2) + ImageName[256]
    const count = buf.readUInt32LE(0);
    const drivers: DetectedDriver[] = [];

    let offset = 8;
    for (let i = 0; i < count && offset + 296 <= buf.length; i++) {
      // ImageName is at offset 40 (Reserved+ImageBase+ImageSize+Flags+Index+Unknown+LoadCount+ModuleNameOffset)
      // Actually, the name starts at offset 40 in the RTL_PROCESS_MODULES structure (x64)
      const nameStart = offset + 40;
      let nameEnd = nameStart;
      while (nameEnd < nameStart + 256 && nameEnd < buf.length && buf[nameEnd] !== 0) {
        nameEnd++;
      }
      const driverName = buf.toString('utf8', nameStart, nameEnd).trim();

      if (driverName) {
        const lowerName = driverName.toLowerCase();
        for (const { pattern, category } of ANTICHEAT_DRIVER_PATTERNS) {
          if (lowerName.includes(pattern.toLowerCase())) {
            drivers.push({
              name: driverName,
              matchedPattern: pattern,
              category,
            });
            break; // first match wins
          }
        }
      }

      // Each entry is 296 bytes (RTL_PROCESS_MODULES record size on x64)
      offset += 296;
    }

    return { drivers };
  } catch {
    // koffi not available — fall back to driverquery
    return fallbackDriverEnumeration();
  }
}

/** Fallback: use `driverquery` command. */
function fallbackDriverEnumeration(): { drivers: DetectedDriver[]; error?: string } {
  try {
    const { execSync } = require('node:child_process');
    const output = execSync('driverquery /FO CSV /NH', {
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    }) as string;

    const drivers: DetectedDriver[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const { pattern, category } of ANTICHEAT_DRIVER_PATTERNS) {
        if (lower.includes(pattern.toLowerCase())) {
          // Extract module name from CSV
          const parts = line.split(',');
          const name = (parts[0] || '').replace(/^"|"$/g, '').trim();
          if (name && !drivers.some((d) => d.name === name)) {
            drivers.push({ name, matchedPattern: pattern, category });
          }
          break;
        }
      }
    }

    return { drivers };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { drivers: [], error: `Driver enumeration failed: ${msg}` };
  }
}

/**
 * Enumerate active ETW kernel trace sessions.
 *
 * Uses `logman query -ets` to list active Event Trace Sessions.
 * Filters for kernel-level providers that indicate monitoring.
 */
function enumerateKernelTraceSessions(): {
  sessions: string[];
  threatIntelActive: boolean;
  error?: string;
} {
  if (process.platform !== 'win32') {
    return { sessions: [], threatIntelActive: false };
  }

  try {
    const { execSync } = require('node:child_process');
    const output = execSync('logman query -ets', {
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    }) as string;

    const lowerOut = output.toLowerCase();
    const sessions: string[] = [];
    let threatIntelActive = false;

    // Check for kernel trace sessions
    const kernelSessionNames = [
      'nt kernel logger',
      'circular kernel context logger',
      'eventlog-security',
      'defender',
    ];

    for (const name of kernelSessionNames) {
      if (lowerOut.includes(name)) {
        sessions.push(name);
      }
    }

    // Check for Threat Intelligence provider GUID in active sessions
    const tiGuid = 'f4e1897c-bb5d-5668-f1d8-040f4d8dd344';
    if (lowerOut.includes(tiGuid)) {
      threatIntelActive = true;
      sessions.push('Microsoft-Windows-Threat-Intelligence (ACTIVE)');
    }

    // Also check for kernel process/thread providers
    const kernelProcessGuid = '22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716';
    if (lowerOut.includes(kernelProcessGuid)) {
      sessions.push('Microsoft-Windows-Kernel-Process (ACTIVE)');
    }

    return { sessions, threatIntelActive };
  } catch {
    return { sessions: [], threatIntelActive: false, error: 'logman unavailable' };
  }
}

/**
 * Check which processes have open handles to our process.
 *
 * Uses NtQuerySystemInformation(SystemHandleInformation) — a massive
 * system-wide handle dump. Filters for handles targeting our PID.
 *
 * WARNING: This call requires SeDebugPrivilege for full results.
 * Without it, some handles may be missing.
 */
function detectSuspiciousHandles(): { handles: SuspiciousHandle[]; error?: string } {
  if (process.platform !== 'win32') {
    return { handles: [] };
  }

  const ourPid = process.pid;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtQuerySystemInformation = ntdll.func(
      'int32 NtQuerySystemInformation(uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );

    const SYSTEM_HANDLE_INFORMATION = 16;
    const sizeBuf = Buffer.alloc(4);

    let status = NtQuerySystemInformation(
      SYSTEM_HANDLE_INFORMATION,
      null,
      0,
      koffi.address(sizeBuf),
    ) as number;

    const requiredSize = sizeBuf.readUInt32LE(0);
    if (requiredSize === 0 || requiredSize > 64 * 1024 * 1024) {
      try {
        ntdll.unload();
      } catch {
        /* ignore */
      }
      return { handles: [], error: `Invalid buffer size: ${requiredSize}` };
    }

    const buf = Buffer.alloc(requiredSize + 65536);
    status = NtQuerySystemInformation(
      SYSTEM_HANDLE_INFORMATION,
      koffi.address(buf),
      buf.length,
      koffi.address(sizeBuf),
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    if (status < 0) {
      return {
        handles: [],
        error: `SystemHandleInformation requires SeDebugPrivilege (0x${(status >>> 0).toString(16)})`,
      };
    }

    // Parse SYSTEM_HANDLE_INFORMATION:
    //   ULONG Count (offset 0)
    //   SYSTEM_HANDLE_TABLE_ENTRY_INFO[Count] starting at offset 8 (x64) / 4 (x86)
    //   Each entry (x64): UniqueProcessId(4) + ObjectTypeIndex(2) +
    //     HandleAttributes(2) + HandleValue(4) + Object(8) + GrantedAccess(4)
    const count = buf.readUInt32LE(0);
    const handles: SuspiciousHandle[] = [];

    // On x64, the handle count is at offset 0 and entries start at offset 8
    let offset = 8;
    const entrySize = 24; // SYSTEM_HANDLE_TABLE_ENTRY_INFO size on x64

    for (let i = 0; i < count && offset + entrySize <= buf.length; i++) {
      const pid = buf.readUInt32LE(offset);
      // Object pointer at offset 8
      // GrantedAccess at offset 16
      const grantedAccess = buf.readUInt32LE(offset + 16);

      if (pid === ourPid && grantedAccess !== 0) {
        // This is a handle TO us. The handle owner PID is not in this struct
        // directly — we'd need SystemExtendedHandleInformation (class 64)
        // for that. With basic SystemHandleInformation, we can only tell
        // that someone has handles to us, not who.
        //
        // A non-zero access mask on our PID is suspicious — at minimum it
        // indicates monitoring interest.
        const accessDesc = describeAccess(grantedAccess);
        if (accessDesc !== '0x0') {
          handles.push({
            pid: ourPid,
            processName: 'self',
            accessMask: grantedAccess,
            accessDescription: accessDesc,
          });
        }
      }

      offset += entrySize;
    }

    return { handles };
  } catch {
    return { handles: [], error: 'Handle enumeration unavailable (koffi not loaded)' };
  }
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

let cachedResult: KernelCallbackReport | null = null;

/**
 * Run all kernel callback detection checks.
 *
 * This provides the best-effort user-mode visibility into kernel callbacks:
 * 1. Loaded anti-cheat/EDR/AV driver detection
 * 2. Active ETW kernel trace session enumeration
 * 3. Suspicious handle detection (who has handles to us)
 *
 * HONEST BOUNDARIES:
 * - ObRegisterCallbacks cannot be enumerated from user-mode
 * - PsSetCreateProcessNotifyRoutine callbacks cannot be enumerated from user-mode
 * - ETW-TI (Threat Intelligence) provider cannot be disabled from user-mode
 * - Actual callback ARRAY contents require kernel R/W (BYOVD)
 *
 * These limitations are reported in the result's `limitations` field.
 */
export function detectKernelCallbacks(): KernelCallbackReport {
  if (cachedResult) return cachedResult;

  const limitations: string[] = [
    'ObRegisterCallbacks cannot be enumerated from user-mode',
    'PsSetCreateProcessNotifyRoutine callbacks cannot be enumerated from user-mode',
    'ETW-TI provider requires PPL or kernel driver to consume/disable',
    'Driver presence does not guarantee active callbacks',
  ];

  // 1. Detect loaded drivers
  const { drivers: detectedDrivers, error: driverError } = detectDriversByModuleList();
  if (driverError) {
    limitations.push(`Driver enumeration: ${driverError}`);
  }

  // 2. Enumerate kernel trace sessions
  const {
    sessions: activeKernelTraceSessions,
    threatIntelActive: threatIntelEtwActive,
    error: sessionError,
  } = enumerateKernelTraceSessions();
  if (sessionError) {
    limitations.push(`Kernel trace enumeration: ${sessionError}`);
  }

  // 3. Detect suspicious handles
  const { handles: suspiciousHandles, error: handleError } = detectSuspiciousHandles();
  if (handleError) {
    limitations.push(`Handle enumeration: ${handleError}`);
  }

  // Determine verdict
  let verdict: KernelCallbackReport['verdict'] = 'clean';
  if (detectedDrivers.length > 0 || threatIntelEtwActive) {
    verdict = 'hostile';
  } else if (suspiciousHandles.length > 0 || activeKernelTraceSessions.length > 0) {
    verdict = 'suspicious';
  }

  const result: KernelCallbackReport = {
    detectedDrivers,
    suspiciousHandles,
    activeKernelTraceSessions,
    threatIntelEtwActive,
    verdict,
    limitations,
    checkedAt: Date.now(),
  };

  cachedResult = result;

  if (verdict === 'hostile') {
    logger.warn('Kernel callback detection: hostile environment detected', {
      driverCount: detectedDrivers.length,
      drivers: detectedDrivers.map((d) => d.name),
      threatIntelEtw: threatIntelEtwActive,
    });
  } else if (verdict === 'suspicious') {
    logger.debug('Kernel callback detection: suspicious signals', {
      traceSessions: activeKernelTraceSessions,
      suspiciousHandleCount: suspiciousHandles.length,
    });
  }

  return result;
}

/** Reset cached result (for testing). */
export function resetKernelCallbackCache(): void {
  cachedResult = null;
}

// ── Helper: Check if a specific process has open handles to us ───────────────

/**
 * Use NtQuerySystemInformation(SystemExtendedHandleInformation, class 64)
 * to determine WHICH process holds handles to our process.
 *
 * This is more detailed than detectSuspiciousHandles() — it includes the
 * owning PID for each handle, so we can identify the monitoring process.
 *
 * HONEST BOUNDARY: Requires SeDebugPrivilege on most systems.
 * Without it, returns an error.
 */
export function enumerateHandleOwners(ourPid: number = process.pid): {
  owners: Array<{ ownerPid: number; accessDescription: string }>;
  error?: string;
} {
  if (process.platform !== 'win32') {
    return { owners: [], error: 'Only available on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtQuerySystemInformation = ntdll.func(
      'int32 NtQuerySystemInformation(uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );

    const SYSTEM_EXTENDED_HANDLE_INFORMATION = 64;
    const sizeBuf = Buffer.alloc(4);

    let status = NtQuerySystemInformation(
      SYSTEM_EXTENDED_HANDLE_INFORMATION,
      null,
      0,
      koffi.address(sizeBuf),
    ) as number;

    const requiredSize = sizeBuf.readUInt32LE(0);
    if (requiredSize === 0 || requiredSize > 64 * 1024 * 1024) {
      try {
        ntdll.unload();
      } catch {
        /* ignore */
      }
      return { owners: [], error: `Invalid buffer size: ${requiredSize}` };
    }

    const buf = Buffer.alloc(requiredSize + 65536);
    status = NtQuerySystemInformation(
      SYSTEM_EXTENDED_HANDLE_INFORMATION,
      koffi.address(buf),
      buf.length,
      koffi.address(sizeBuf),
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    if (status < 0) {
      return {
        owners: [],
        error: `ExtendedHandleInformation requires SeDebugPrivilege (0x${(status >>> 0).toString(16)})`,
      };
    }

    // Parse SYSTEM_EXTENDED_HANDLE_INFORMATION:
    //   ULONG64 HandleCount
    //   SYSTEM_EXTENDED_HANDLE_ENTRY[HandleCount]
    //   Each entry (x64): Object(8) + UniqueProcessId(8) + HandleValue(8) +
    //     GrantedAccess(4) + HandleAttributes(2) + ObjectTypeIndex(2)
    const handleCount = Number(buf.readBigUInt64LE(0));
    const owners: Array<{ ownerPid: number; accessDescription: string }> = [];

    let offset = 8;
    const entrySize = 32; // SYSTEM_EXTENDED_HANDLE_ENTRY on x64

    for (let i = 0; i < handleCount && offset + entrySize <= buf.length; i++) {
      const targetPid = Number(buf.readBigUInt64LE(offset + 8));
      const ownerPid = Number(buf.readBigUInt64LE(offset));
      const grantedAccess = buf.readUInt32LE(offset + 24);

      if (targetPid === ourPid && ownerPid !== ourPid && grantedAccess !== 0) {
        const accessDesc = describeAccess(grantedAccess);
        if (accessDesc !== '0x0') {
          owners.push({ ownerPid, accessDescription: accessDesc });
        }
      }

      offset += entrySize;
    }

    return { owners };
  } catch {
    return { owners: [], error: 'Extended handle enumeration unavailable' };
  }
}
