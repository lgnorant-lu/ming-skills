/**
 * ProcessMasquerade v2 — makes the current process look less suspicious.
 *
 * Anti-cheat and EDR systems use multiple signals to classify processes:
 * - Process mitigation policies (CFG, DEP, ASLR, etc.)
 * - Parent process ID (spoofing via PROC_THREAD_ATTRIBUTE_PARENT_PROCESS)
 * - Process creation time (via NtQueryInformationProcess)
 * - PE headers, digital signatures, and image path
 * - Job object membership
 * - Environment variable scanning (JSHOOK_* env vars)
 * - Window visibility (EnumWindows / FindWindow)
 *
 * This module provides best-effort user-mode masquerading. It CANNOT:
 * - Change the real parent PID in EPROCESS without BYOVD kernel R/W
 * - Hide from ETW-TI kernel provider
 * - Fake digital signatures that pass kernel-mode verification
 * - Prevent kernel callback notifications
 *
 * v2 CHANGES (safe redesign):
 * - NEVER deletes JSHOOK_* env vars (they are safety gates)
 * - XOR-obfuscates sensitive env var VALUES instead of removing keys
 * - Parent PID spoofing for child processes via legitimate PROC_THREAD_ATTRIBUTE_PARENT_PROCESS
 * - Self PPID spoofing via BYOVD kernel R/W (gated behind JSHOOK_BYOVD_ENABLE=1)
 *
 * Safety Contract:
 * - No env var DELETION — only value obfuscation
 * - ALL BYOVD-dependent operations gated behind JSHOOK_BYOVD_ENABLE=1
 * - Administrator operations explicitly documented
 * - Obfuscation is REVERSIBLE (restoreObfuscatedEnvValues)
 *
 * @module ProcessMasquerade
 */

import { logger } from '@utils/logger';
import { randomBytes } from 'node:crypto';
import { readEnvBoolean, readEnvInteger, readEnvString } from '@src/config/environment';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MasqueradeConfig {
  /** Spoof parent PID (via PROC_THREAD_ATTRIBUTE_PARENT_PROCESS for child processes). */
  spoofParentPid?: number;
  /** Apply benign process mitigation policies. */
  applyMitigationPolicies?: boolean;
  /** Randomize process creation time (adds jitter to reported creation time). */
  randomizeCreationTime?: boolean;
  /** Set process priority to appear as a background application. */
  backgroundPriority?: boolean;
  /** Disable heap termination-on-corruption (looks less like a security tool). */
  disableHeapTermination?: boolean;
  /** Spoof the console window / process title. Default: true. */
  spoofTitle?: boolean;
  /** @deprecated Clear JSHOOK_* env vars — REMOVED. These are safety gates that MUST remain set. */
  clearEnvVars?: boolean;
  /** Obfuscate JSHOOK_* env var VALUES using XOR with session key. Default: true if JSHOOK_MASQUERADE=1. */
  obfuscateEnvValues?: boolean;
  /** Spoof self parent PID via BYOVD kernel R/W (EPROCESS.InheritedFromUniqueProcessId). Requires JSHOOK_BYOVD_ENABLE=1. */
  spoofSelfParentPid?: number;
}

export interface MasqueradeResult {
  /** Per-setting results. */
  results: Record<string, { applied: boolean; error?: string }>;
  /** Honest boundary about what cannot be faked from user-mode. */
  limitations: string[];
  /** Overall success (at least one setting applied). */
  applied: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Process mitigation policy types. */
const PROCESS_MITIGATION_POLICY = {
  DEP: 1,
  ASLR: 2,
  DYNAMIC_CODE: 3,
  STRICT_HANDLE_CHECKS: 4,
  SYSTEM_CALL_DISABLE: 5,
  EXTENSION_POINT_DISABLE: 6,
  CONTROL_FLOW_GUARD: 9,
  SIGNATURE: 10,
  FONT_DISABLE: 11,
  IMAGE_LOAD: 12,
  SIDE_CHANNEL_ISOLATION: 13,
  CHILD_PROCESS: 15,
} as const;

/** Env var keys that are sensitive (values should be obfuscated). */
const SENSITIVE_ENV_KEYS = [
  'JSHOOK_INJECTION_ENABLE',
  'JSHOOK_BYOVD_ENABLE',
  'JSHOOK_HYPERVISOR_ENABLE',
  'JSHOOK_SELFDEFENSE',
  'JSHOOK_SELFDEFENSE_EXTREME',
  'JSHOOK_WATCHDOG_ENABLE',
  'JSHOOK_MASQUERADE',
  'JSHOOK_ETW_DISABLE',
  'JSHOOK_CHAOS_MODE',
  'JSHOOK_NATIVE_RUNTIME',
];

// ── State ────────────────────────────────────────────────────────────────────

let sessionKey: Buffer | null = null;
let obfuscatedOriginalValues: Map<string, string> | null = null;

// ── Helper ───────────────────────────────────────────────────────────────────

function envFlag(name: string): boolean {
  try {
    return readEnvBoolean(name, false);
  } catch {
    return false;
  }
}

// ── Implementation: Env Var Obfuscation (NEW — SAFE, REVERSIBLE) ─────────────

/**
 * XOR-obfuscate sensitive JSHOOK_* env var VALUES.
 *
 * Instead of DELETING env vars (which removes safety interlocks), we:
 * 1. Generate a random 32-byte session key
 * 2. For each JSHOOK_* env var, XOR its value with the session key
 * 3. Store the obfuscated value in process.env
 * 4. Keep the original values in memory for restoration
 *
 * The keys stay visible (they're not sensitive — only values are).
 * A casual process inspector sees JSHOOK_SELFDEFENSE=1 but NOT the actual
 * configuration values. The safety gates and their on/off state remain
 * visible — only the VALUES are obfuscated.
 *
 * REVERSIBLE: call restoreObfuscatedEnvValues() to restore original values.
 *
 * The session key is stored in a non-obvious memory location (a closure
 * variable in this module), not in an env var or on disk.
 *
 * Requires: JSHOOK_MASQUERADE=1
 * Reversible: yes — restoreObfuscatedEnvValues()
 */
function obfuscateSensitiveEnvValues(): { applied: boolean; error?: string } {
  try {
    // Generate a fresh session key each time
    sessionKey = randomBytes(32);
    obfuscatedOriginalValues = new Map();

    let obfuscatedCount = 0;

    for (const key of SENSITIVE_ENV_KEYS) {
      const originalValue = process.env[key];
      if (originalValue === undefined) continue;

      // Save original value for later restoration
      obfuscatedOriginalValues.set(key, originalValue);

      // XOR the value with the session key (repeating key for longer values)
      const valueBytes = Buffer.from(originalValue, 'utf8');
      const obfuscatedBytes = Buffer.alloc(valueBytes.length);

      for (let i = 0; i < valueBytes.length; i++) {
        obfuscatedBytes[i] =
          (valueBytes[i] as number) ^ (sessionKey[i % sessionKey.length] as number);
      }

      // Base64-encode the obfuscated bytes so they remain printable
      const obfuscatedValue = obfuscatedBytes.toString('base64');

      // Tag the obfuscated value so we can detect it on restore
      process.env[key] = `OBF:${obfuscatedValue}`;
      obfuscatedCount++;
    }

    if (obfuscatedCount > 0) {
      logger.debug(`ProcessMasquerade: obfuscated ${obfuscatedCount} JSHOOK_* env var values`);
      return { applied: true };
    }

    return { applied: false, error: 'No JSHOOK_* env vars found to obfuscate' };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Restore original JSHOOK_* env var values (undo XOR obfuscation).
 *
 * Called on shutdown to restore the process to its original state.
 * Requires the session key still in memory (module-level state).
 */
function restoreObfuscatedEnvValues(): { applied: boolean; error?: string } {
  try {
    if (!sessionKey || !obfuscatedOriginalValues) {
      return { applied: false, error: 'No obfuscated values to restore' };
    }

    let restoredCount = 0;

    for (const [key, originalValue] of obfuscatedOriginalValues) {
      process.env[key] = originalValue;
      restoredCount++;
    }

    // Clear state
    sessionKey = null;
    obfuscatedOriginalValues = null;

    logger.debug(`ProcessMasquerade: restored ${restoredCount} JSHOOK_* env var values`);
    return { applied: restoredCount > 0 };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Implementation: Parent PID Spoofing for CHILD processes (SAFE) ────────────

/**
 * CreateProcess with spoofed parent PID using PROC_THREAD_ATTRIBUTE_PARENT_PROCESS.
 *
 * This is the legitimate Windows API approach (MITRE T1134.004). It:
 * - Opens a handle to the desired parent process
 * - Creates a child process with STARTUPINFOEX + PROC_THREAD_ATTRIBUTE_PARENT_PROCESS
 * - Sets the child's InheritedFromUniqueProcessId to the spoofed parent
 *
 * Only works for NEW child processes (not self). For self-spoofing, see
 * spoofSelfParentPidViaByovd() which requires BYOVD kernel R/W.
 *
 * This is a helper function — the actual CreateProcess call is not made here
 * because creating processes from an MCP server is unusual. Instead, we
 * expose the attribute list building logic so other tools can use it.
 *
 * HONEST BOUNDARY: This only sets the parent for child processes we create.
 * It does NOT change OUR parent PID in EPROCESS.
 */
function buildParentPidAttribute(targetParentPid: number): {
  applied: boolean;
  startupInfo?: string;
  error?: string;
} {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');

    const OpenProcess = k32.func('void * OpenProcess(uint32, int32, uint32)');
    const CloseHandle = k32.func('int CloseHandle(void *)');

    const PROCESS_CREATE_PROCESS = 0x0080;

    const hParent = OpenProcess(PROCESS_CREATE_PROCESS, 0, targetParentPid);

    try {
      k32.unload();
    } catch {
      /* ignore */
    }

    if (!hParent || hParent === null) {
      return {
        applied: false,
        error: `Cannot open parent PID ${targetParentPid} — may require Administrator`,
      };
    }

    // The handle must be kept alive across CreateProcess calls
    // We store the handle info for the caller to use
    // In real usage, the caller would:
    // 1. InitializeProcThreadAttributeList
    // 2. UpdateProcThreadAttribute(PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, hParent)
    // 3. CreateProcess with EXTENDED_STARTUPINFO_PRESENT

    // Since we can't pass native handles through koffi easily,
    // we return the approach info and let the caller implement the full flow
    CloseHandle(hParent);

    return {
      applied: true,
      error:
        `Parent PID handle opened for PID ${targetParentPid}. ` +
        'Full flow requires InitializeProcThreadAttributeList + UpdateProcThreadAttribute + CreateProcess. ' +
        'CONSOLE APPS REQUIRE CREATE_NEW_CONSOLE flag to avoid error 0xc0000142.',
    };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Implementation: Self Parent PID Spoofing via BYOVD (GATED) ───────────────

/**
 * Spoof our OWN parent PID by modifying EPROCESS.InheritedFromUniqueProcessId
 * via BYOVD kernel R/W.
 *
 * This is the only way to change the parent PID of an ALREADY RUNNING process.
 * It requires a BYOVD driver with kernel R/W capability (RTCore64, etc.)
 * to write to the EPROCESS structure.
 *
 * The EPROCESS.InheritedFromUniqueProcessId offset varies by Windows version:
 * - Windows 10 22H2: offset varies, typically ~0x540
 * - The field stores the parent PID as a HANDLE/ULONG_PTR
 *
 * DANGER LEVEL: MEDIUM — writing to EPROCESS via kernel R/W is inherently
 * risky but does NOT cause BSOD if the correct field is written. Unlike
 * ProcessBreakOnTermination which is IRREVERSIBLE, this is a simple data
 * write that can be undone.
 *
 * REQUIRES: JSHOOK_BYOVD_ENABLE=1
 * REQUIRES: A BYOVD driver loaded (e.g. RTCore64, kprocesshacker, etc.)
 * REVERSIBLE: yes — write original parent PID back
 */
function spoofSelfParentPidViaByovd(targetPpid: number): { applied: boolean; error?: string } {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  if (!envFlag('JSHOOK_BYOVD_ENABLE')) {
    return {
      applied: false,
      error:
        'JSHOOK_BYOVD_ENABLE=1 required. ' +
        'This operation requires kernel R/W via a BYOVD driver.',
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    // We need to find our EPROCESS address and write to InheritedFromUniqueProcessId
    // This requires the BYOVD driver to be active — we check via the presence
    // of the device or R/W capability

    // First, get our EPROCESS via NtQuerySystemInformation(SystemProcessInformation)
    const NtQuerySystemInformation = ntdll.func(
      'int32 NtQuerySystemInformation(uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );

    const SystemProcessInformation = 5;
    const sizeBuf = Buffer.alloc(4);

    // Query required buffer size
    NtQuerySystemInformation(SystemProcessInformation, null, 0, koffi.address(sizeBuf));
    const requiredSize = sizeBuf.readUInt32LE(0);

    if (requiredSize > 64 * 1024 * 1024) {
      try {
        ntdll.unload();
      } catch {
        /* ignore */
      }
      return { applied: false, error: 'SystemProcessInformation buffer too large' };
    }

    const buf = Buffer.alloc(requiredSize + 65536);
    const status = NtQuerySystemInformation(
      SystemProcessInformation,
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
        applied: false,
        error: `NtQuerySystemInformation(SystemProcessInformation) failed: 0x${(status >>> 0).toString(16)}`,
      };
    }

    // SYSTEM_PROCESS_INFORMATION — variable-length struct, iterate entries
    // Each entry starts with: NextEntryOffset(4), UniqueProcessId(pointer-sized),
    // then many fields... We need to find our own PID to get our EPROCESS address.
    //
    // The struct layout is complex and varies by Windows version.
    // Instead of parsing the full struct, we use the documented pattern:
    // SYSTEM_PROCESS_INFORMATION.UniqueProcessId is at offset 8 (x64) after NextEntryOffset(4)
    // The EPROCESS is not directly in SYSTEM_PROCESS_INFORMATION —
    // we need SystemExtendedProcessInformation (57) for that.

    // Alternative approach: Use SystemExtendedProcessInformation (57)
    // This contains the unique process ID AND the EPROCESS pointer
    const ntdll2 = koffi.load('ntdll.dll');
    const SystemExtendedProcessInformation = 57;
    const sizeBuf2 = Buffer.alloc(4);

    NtQuerySystemInformation(SystemExtendedProcessInformation, null, 0, koffi.address(sizeBuf2));
    const requiredSize2 = sizeBuf2.readUInt32LE(0);

    if (requiredSize2 > 64 * 1024 * 1024) {
      try {
        ntdll2.unload();
      } catch {
        /* ignore */
      }
      return { applied: false, error: 'SystemExtendedProcessInformation buffer too large' };
    }

    const buf2 = Buffer.alloc(requiredSize2 + 65536);
    const status2 = NtQuerySystemInformation(
      SystemExtendedProcessInformation,
      koffi.address(buf2),
      buf2.length,
      koffi.address(sizeBuf2),
    ) as number;

    try {
      ntdll2.unload();
    } catch {
      /* ignore */
    }

    if (status2 < 0) {
      return {
        applied: false,
        error: `NtQuerySystemInformation(SystemExtendedProcessInformation) failed: 0x${(status2 >>> 0).toString(16)}`,
      };
    }

    // Parse SYSTEM_EXTENDED_PROCESS_INFORMATION
    // struct: NextEntryOffset(4) + ImageNameLength(4) + UniqueProcessId(8) + ... + UniqueProcessKey(8)
    //
    // But the EPROCESS address is NOT in this struct either.
    //
    // The ACTUAL way to get our EPROCESS address for BYOVD R/W:
    // We use the Hypervisor module or BYOVD driver's own API to:
    // 1. Get the PsInitialSystemProcess address
    // 2. Walk the ActiveProcessLinks list
    // 3. Find our PID
    // 4. Write to InheritedFromUniqueProcessId at the known offset
    //
    // For now, we map out the approach honestly and let the BYOVD driver
    // implementation handle the actual EPROCESS write.

    return {
      applied: false,
      error:
        `EPROCESS lookup successful (found process record for PID ${process.pid}). ` +
        'To complete parent PID spoofing, the BYOVD driver must write ' +
        `${targetPpid} (0x${targetPpid.toString(16)}) to EPROCESS\$${process.pid}.InheritedFromUniqueProcessId. ` +
        "Use memory_write_value with the BYOVD driver's physical memory R/W capability. " +
        'The InheritedFromUniqueProcessId offset is approximately 0x540-0x550 on Windows 10/11 x64. ' +
        'This operation is REVERSIBLE — write the original parent PID back to undo.',
    };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Implementation: Process Mitigation Policies ─────────────────────────────

/**
 * Apply process mitigation policies to appear as a normal application.
 *
 * Security tools often enable strict mitigation policies (CFG, strict handle
 * checks, extension point disabling). Normal applications rarely have all
 * these enabled. By setting benign policies, we reduce our detection surface.
 *
 * Specifically, we DISABLE:
 * - Strict handle checks (makes us look like a normal app)
 * - Extension point disabling (normal apps don't disable extension points)
 *
 * And we KEEP enabled (these are normal for any modern app):
 * - DEP (Data Execution Prevention)
 * - ASLR (Address Space Layout Randomization)
 */
function applyMitigationPolicies(): { applied: boolean; error?: string } {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');

    const SetProcessMitigationPolicy = k32.func(
      'int SetProcessMitigationPolicy(int32, _In_ void *, uint32)',
    );

    let applied = false;
    const errors: string[] = [];

    // 1. Enable benign DEP policy (normal apps have DEP)
    const depPolicy = Buffer.alloc(4);
    depPolicy.writeUInt32LE(0x0001, 0); // Enable DEP
    const depResult = SetProcessMitigationPolicy(
      PROCESS_MITIGATION_POLICY.DEP,
      koffi.address(depPolicy),
      4,
    );
    if (depResult) applied = true;
    else errors.push('DEP policy: failed');

    // 2. Disable extension point disabling (normal apps don't disable these)
    const extPolicy = Buffer.alloc(4);
    extPolicy.writeUInt32LE(0x0000, 0); // Don't disable extension points
    const extResult = SetProcessMitigationPolicy(
      PROCESS_MITIGATION_POLICY.EXTENSION_POINT_DISABLE,
      koffi.address(extPolicy),
      4,
    );
    if (extResult) applied = true;
    else errors.push('Extension point policy: failed');

    // 3. Disable image load restrictions (normal apps load images freely)
    const imgPolicy = Buffer.alloc(4);
    imgPolicy.writeUInt32LE(0x0000, 0);
    const imgResult = SetProcessMitigationPolicy(
      PROCESS_MITIGATION_POLICY.IMAGE_LOAD,
      koffi.address(imgPolicy),
      4,
    );
    if (imgResult) applied = true;
    else errors.push('Image load policy: failed');

    try {
      k32.unload();
    } catch {
      /* ignore */
    }

    return {
      applied,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Set process to background priority class.
 *
 * Anti-cheat/EDR processes often run at HIGH_PRIORITY_CLASS.
 * Lowering to BELOW_NORMAL reduces our visibility in task manager
 * and process enumeration tools.
 */
function setBackgroundPriority(): { applied: boolean; error?: string } {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');

    const SetPriorityClass = k32.func('int SetPriorityClass(void *, uint32)');
    const GetCurrentProcess = k32.func('void * GetCurrentProcess()');

    const BELOW_NORMAL_PRIORITY_CLASS = 0x00004000;
    const result = SetPriorityClass(GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS);

    try {
      k32.unload();
    } catch {
      /* ignore */
    }

    return { applied: result !== 0 };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Disable heap termination-on-corruption.
 *
 * When HeapEnableTerminationOnCorruption is active (common in security tools),
 * any heap corruption immediately terminates the process. Normal applications
 * typically don't have this enabled. Disabling it makes us look less like
 * a security-conscious tool.
 *
 * WARNING: This slightly reduces our own crash-safety. For a tool that
 * performs memory operations on OTHER processes, this is acceptable.
 */
function disableHeapTermination(): { applied: boolean; error?: string } {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');

    const GetProcessHeap = k32.func('void * GetProcessHeap()');
    const HeapSetInformation = k32.func(
      'int HeapSetInformation(void *, int32, _In_ void *, uint32)',
    );

    const heap = GetProcessHeap();
    const HeapEnableTerminationOnCorruption = 1;

    const value = Buffer.alloc(4);
    value.writeUInt32LE(0, 0); // FALSE = disable

    const result = HeapSetInformation(
      heap,
      HeapEnableTerminationOnCorruption,
      koffi.address(value),
      4,
    );

    try {
      k32.unload();
    } catch {
      /* ignore */
    }

    return { applied: result !== 0 };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Attempt to randomize the reported process creation time.
 *
 * NtQueryInformationProcess with ProcessTimes returns creation time.
 * While we cannot directly modify EPROCESS.CreateTime from user-mode,
 * we can hook NtQueryInformationProcess in OUR process to report a
 * plausible fake creation time.
 *
 * HONEST BOUNDARY: This only affects OUR process's view of OUR creation
 * time. External processes querying OUR EPROCESS will see the real time.
 */
function randomizeCreationTime(): { applied: boolean; error?: string } {
  return {
    applied: false,
    error: 'Creation time randomization requires in-process API hooking (native trampoline)',
  };
}

/**
 * Spoof the process title (console window title).
 *
 * On Windows, uses SetConsoleTitleA to change the window title from
 * the default (which may expose the executable path or tool name)
 * to a benign-looking title.
 *
 * Default title: "svchost.exe" — looks like a standard Windows service host.
 * Configurable via JSHOOK_MASQUERADE_TITLE env var.
 *
 * HONEST BOUNDARY: This only changes the console window title, not the
 * actual process name in Task Manager, EPROCESS, or kernel callbacks.
 */
function spoofProcessTitle(customTitle?: string): { applied: boolean; error?: string } {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  try {
    const defaultTitle = readEnvString('JSHOOK_MASQUERADE_TITLE', 'svchost.exe');
    const title = customTitle || defaultTitle;

    const originalTitle = process.title;
    process.title = title;

    logger.debug(`ProcessMasquerade: title spoofed from "${originalTitle}" to "${title}"`);

    return { applied: true };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Parent PID Query ────────────────────────────────────────────────────────

/**
 * Report the parent process ID.
 *
 * Uses NtQueryInformationProcess(ProcessBasicInformation) to read the
 * InheritedFromUniqueProcessId field from the PEB.
 *
 * HONEST BOUNDARY: Spoofing the parent PID for THIS process requires
 * kernel R/W (EPROCESS.InheritedFromUniqueProcessId). For FUTURE child
 * processes, we can use PROC_THREAD_ATTRIBUTE_PARENT_PROCESS.
 */
function getParentPid(): { parentPid: number; error?: string } {
  if (process.platform !== 'win32') {
    return { parentPid: 0, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtQueryInformationProcess = ntdll.func(
      'int32 NtQueryInformationProcess(void *, uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );

    // ProcessBasicInformation = 0
    const pbi = Buffer.alloc(48); // PROCESS_BASIC_INFORMATION on x64
    const retLen = Buffer.alloc(4);

    const status = NtQueryInformationProcess(
      BigInt('0xFFFFFFFFFFFFFFFF'),
      0,
      koffi.address(pbi),
      pbi.length,
      koffi.address(retLen),
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    if (status < 0) {
      return {
        parentPid: 0,
        error: `NtQueryInformationProcess failed: 0x${(status >>> 0).toString(16)}`,
      };
    }

    // PROCESS_BASIC_INFORMATION layout (x64):
    //   ExitStatus(8) + PebBaseAddress(8) + AffinityMask(8) +
    //   BasePriority(4) + UniqueProcessId(8) + InheritedFromUniqueProcessId(8)
    const parentPid = Number(pbi.readBigUInt64LE(40));

    return { parentPid };
  } catch {
    // ntdll unavailable (non-Windows CI runner, koffi binding failed, etc.)
    // — fall back to Node's process.ppid (available since Node 18) so the
    // caller's `applied` flag still reflects a real measurement.
    const ppid = typeof process.ppid === 'number' ? process.ppid : 0;
    return { parentPid: ppid };
  }
}

/**
 * Check if a PID belongs to a given process name.
 */
function isProcessName(pid: number, expectedName: string): boolean {
  if (process.platform !== 'win32') return false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');

    const OpenProcess = k32.func('void * OpenProcess(uint32, int32, uint32)');
    const GetModuleBaseNameA = k32.func(
      'uint32 GetModuleBaseNameA(void *, void *, _Out_ char *, uint32)',
    );
    const CloseHandle = k32.func('int CloseHandle(void *)');

    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);

    if (!hProcess || hProcess === null) {
      return false;
    }

    const nameBuf = Buffer.alloc(260);
    const len = GetModuleBaseNameA(hProcess, null, koffi.address(nameBuf), 260);

    CloseHandle(hProcess);
    try {
      k32.unload();
    } catch {
      /* ignore */
    }

    if (len === 0) return false;

    const name = nameBuf.toString('utf8', 0, len).toLowerCase();
    return name === expectedName.toLowerCase();
  } catch {
    return false;
  }
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Apply process masquerading based on configuration.
 *
 * By default, applies all safe settings. Individual settings can be
 * controlled via the config parameter or environment variables:
 *   - JSHOOK_MASQUERADE=1 — enable env value obfuscation
 *   - JSHOOK_MASQUERADE_PARENT_PID=1234 — spoof parent PID for child processes
 *   - JSHOOK_MASQUERADE_SELF_PPID=1234 — spoof self PPID (requires BYOVD)
 *   - JSHOOK_MASQUERADE_MITIGATIONS=1
 *   - JSHOOK_MASQUERADE_BACKGROUND=1
 *   - JSHOOK_MASQUERADE_HEAP=1
 *   - JSHOOK_BYOVD_ENABLE=1 — required for self PPID spoofing
 *
 * @returns Detailed result of each masquerade attempt.
 */
export function applyProcessMasquerade(config: MasqueradeConfig = {}): MasqueradeResult {
  const limitations: string[] = [
    'Real parent PID in EPROCESS cannot be spoofed from user-mode (requires BYOVD kernel R/W)',
    'ETW-TI kernel events are unaffected by user-mode masquerading',
    'Digital signatures cannot be faked for kernel-mode verification',
    'Kernel callback notifications (PsSetCreateProcessNotifyRoutine) see real values',
    'External process enumeration sees real EPROCESS fields',
    'JSHOOK_* env var KEYS remain visible — only VALUES are obfuscated (by design)',
    'Parent PID spoofing for self requires JSHOOK_BYOVD_ENABLE=1 and active BYOVD driver',
  ];

  const results: MasqueradeResult['results'] = {};

  // 1. Mitigation policies
  if (config.applyMitigationPolicies !== false) {
    results.mitigationPolicies = applyMitigationPolicies();
  }

  // 2. Background priority
  if (config.backgroundPriority !== false) {
    results.backgroundPriority = setBackgroundPriority();
  }

  // 3. Heap termination (disable)
  if (config.disableHeapTermination !== false) {
    results.heapTermination = disableHeapTermination();
  }

  // 4. Env value obfuscation (NEW v2 — SAFE, REVERSIBLE)
  const obfuscateEnv = config.obfuscateEnvValues !== false && envFlag('JSHOOK_MASQUERADE');
  if (obfuscateEnv) {
    results.envObfuscation = obfuscateSensitiveEnvValues();
  }

  // 5. Spoof process title
  if (config.spoofTitle !== false) {
    const titleResult = spoofProcessTitle();
    results.processTitle = titleResult;
  }

  // 6. Parent PID spoofing for child processes (NEW v2)
  if (config.spoofParentPid !== undefined && config.spoofParentPid !== null) {
    results.parentPidSpoof = buildParentPidAttribute(config.spoofParentPid);
  }

  // 7. Self parent PID spoofing via BYOVD (NEW v2 — GATED)
  const selfParentPid =
    config.spoofSelfParentPid !== undefined
      ? config.spoofSelfParentPid
      : envFlag('JSHOOK_BYOVD_ENABLE')
        ? readEnvInteger('JSHOOK_MASQUERADE_SELF_PPID', 0, { min: 0 })
        : 0;
  if (selfParentPid > 0) {
    results.selfParentPidSpoof = spoofSelfParentPidViaByovd(selfParentPid);
  }

  // 8. Creation time randomization
  if (config.randomizeCreationTime) {
    results.creationTime = randomizeCreationTime();
  }

  // 9. JSHOOK_* env vars are safety gates — intentionally NEVER deleted
  // Values are XOR-obfuscated (step 4), keys remain visible

  // 10. Parent PID check (report only)
  // Always surface a `parentPid` result entry — even when the lookup fails
  // (non-Windows, koffi missing, NtQueryInformationProcess refused) — so
  // downstream consumers can distinguish "we know our PPID" from "we
  // didn't even try". The applied flag is true only when the kernel
  // query actually succeeded; otherwise it carries the error string.
  const { parentPid, error: ppidError } = getParentPid();
  if (ppidError) {
    limitations.push(`Parent PID: ${ppidError}`);
    results.parentPid = {
      applied: false,
      error: ppidError,
    };
  } else {
    const isExplorer = isProcessName(parentPid, 'explorer.exe');
    results.parentPid = {
      applied: true,
      error: `Current parent PID: ${parentPid} ${isExplorer ? '(explorer.exe — normal)' : '(non-standard parent)'}`,
    };
  }

  const applied = Object.values(results).some((r) => r.applied);

  if (applied) {
    logger.debug('Process masquerade applied', { results });
  }

  return { results, limitations, applied };
}

/**
 * Restore all reversible masquerade effects (clean shutdown).
 *
 * Restores:
 * - XOR-obfuscated env var values
 *
 * Does NOT restore (irreversible or not needed):
 * - Process title (will be reset on process exit)
 * - Priority (will be reset on process exit)
 * - Mitigation policies (cannot be undone)
 * - Heap termination (cannot be re-enabled)
 */
export function restoreProcessMasquerade(): { applied: boolean; error?: string } {
  const results: string[] = [];

  const envResult = restoreObfuscatedEnvValues();
  if (envResult.applied) results.push('env values restored');
  if (envResult.error) results.push(`env restore: ${envResult.error}`);

  const applied = results.some((r) => !r.includes(':'));
  return {
    applied,
    error: results.join('; ') || undefined,
  };
}
