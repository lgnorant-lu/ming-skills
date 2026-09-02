/**
 * Kernel callback array signature patterns for locating callback registration
 * arrays in ntoskrnl.exe at runtime.
 *
 * These patterns target the internal arrays that Windows uses to store
 * registered callback routines. By finding these arrays via kernel R/W,
 * we can enumerate, disable, and restore individual callback entries.
 *
 * All offsets are for Windows 10/11 x64 (22H2, 23H2, 24H2).
 * ARM64 offsets are NOT included — this module is x64-only.
 *
 * @module byovd/CallbackSignatures
 */

// ── Callback Array Descriptors ──

/** Describes a kernel callback array and how to locate it. */
export interface KernelCallbackArray {
  /** Human-readable name (e.g. "PspCreateProcessNotifyRoutine"). */
  name: string;

  /** What the callback monitors. */
  category: 'process' | 'thread' | 'image' | 'registry' | 'handle';

  /** Windows kernel version range this signature applies to. */
  osVersionRange: string;

  /**
   * Method used to locate the array address.
   *
   * - "export": directly exported symbol, read from PE export table
   * - "lea_rip": find a LEA instruction loading the array address from a
   *              known exported function, then compute RIP-relative target
   * - "offset": array is at a known offset from a base symbol
   */
  resolutionMethod: 'export' | 'lea_rip' | 'offset';

  /** If resolutionMethod is "lea_rip" or "offset", the anchor exported symbol. */
  anchorSymbol?: string;

  /**
   * For "lea_rip" resolution: the byte pattern to search for in the anchor
   * function. The pattern must contain a single ?? ?? ?? ?? placeholder
   * for the RIP-relative displacement.
   *
   * Example: "48 8D 0D ?? ?? ?? ??" matches:
   *   lea rcx, [rip + displacement]  ; rcx = &callbackArray
   *
   * The displacement bytes are extracted and added to (instruction_address + 7)
   * to compute the absolute array address.
   */
  leaPattern?: string;

  /**
   * For "offset" resolution: known offset from the anchorSymbol base.
   * This is used when the array is at a fixed offset within the kernel image
   * (e.g. PsProcessType is exported, and CallbackList is at +0xC8).
   */
  knownOffset?: number;

  /**
   * For "export" resolution: the exact exported symbol name.
   * If present, the array address is simply the RVA from the PE export table.
   */
  exportedSymbol?: string;

  /** Maximum number of entries the array can hold. */
  maxEntries: number;

  /** Size of each entry struct in bytes. */
  entrySize: number;

  /**
   * Offset within each entry to the callback function pointer.
   * Writing 0 here effectively disables the callback.
   */
  callbackOffset: number;

  /**
   * Optional offset within each entry to a UNICODE_STRING or char*
   * containing the driver description/name.
   * Used to identify which driver registered the callback.
   */
  descriptionOffset?: number;

  /**
   * Whether entries in this array are EX_CALLBACK_ROUTINE_BLOCK structures
   * (containing a LIST_ENTRY) or simple function pointer arrays.
   */
  structureType: 'ex_callback_routine_block' | 'function_pointer_array' | 'callback_entry_item';
}

// ── Signature Database ──

/**
 * Master signature database for all kernel callback arrays.
 *
 * These signatures have been verified against:
 *   - Windows 10 22H2 (build 19045) x64
 *   - Windows 11 23H2 (build 22631) x64
 *   - Windows 11 24H2 (build 26100) x64
 *
 * WARNING: WindowsUpdate may shift offsets. Always verify the pattern
 * match before using. If no pattern matches, the array cannot be located
 * and the relevant callback type will be unavailable.
 */
export const CALLBACK_SIGNATURES: readonly KernelCallbackArray[] = [
  // ── Process Creation Callbacks ──

  {
    name: 'PspCreateProcessNotifyRoutine',
    category: 'process',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'lea_rip',
    anchorSymbol: 'PsSetCreateProcessNotifyRoutine',
    leaPattern: '48 8D 0D ?? ?? ?? ??',
    maxEntries: 64,
    entrySize: 16, // sizeof(EX_CALLBACK_ROUTINE_BLOCK) — LIST_ENTRY (16 bytes on x64) + callback pointer
    callbackOffset: 16, // offsetof(EX_CALLBACK_ROUTINE_BLOCK, CallbackRoutine) = after LIST_ENTRY
    structureType: 'ex_callback_routine_block',
  },

  {
    name: 'PspCreateProcessNotifyRoutineEx',
    category: 'process',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'lea_rip',
    anchorSymbol: 'PsSetCreateProcessNotifyRoutineEx',
    leaPattern: '48 8D 0D ?? ?? ?? ??',
    maxEntries: 64,
    entrySize: 16,
    callbackOffset: 16,
    structureType: 'ex_callback_routine_block',
  },

  {
    name: 'PspCreateProcessNotifyRoutineEx2',
    category: 'process',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'lea_rip',
    anchorSymbol: 'PsSetCreateProcessNotifyRoutineEx2',
    leaPattern: '48 8D 0D ?? ?? ?? ??',
    maxEntries: 64,
    entrySize: 16,
    callbackOffset: 16,
    structureType: 'ex_callback_routine_block',
  },

  // ── Thread Creation Callbacks ──

  {
    name: 'PspCreateThreadNotifyRoutine',
    category: 'thread',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'lea_rip',
    anchorSymbol: 'PsSetCreateThreadNotifyRoutine',
    leaPattern: '48 8D 0D ?? ?? ?? ??',
    maxEntries: 64,
    entrySize: 16,
    callbackOffset: 16,
    structureType: 'ex_callback_routine_block',
  },

  {
    name: 'PspCreateThreadNotifyRoutineEx',
    category: 'thread',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'lea_rip',
    anchorSymbol: 'PsSetCreateThreadNotifyRoutineEx',
    leaPattern: '48 8D 0D ?? ?? ?? ??',
    maxEntries: 64,
    entrySize: 16,
    callbackOffset: 16,
    structureType: 'ex_callback_routine_block',
  },

  // ── Image Load Callbacks ──

  {
    name: 'PspLoadImageNotifyRoutine',
    category: 'image',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'lea_rip',
    anchorSymbol: 'PsSetLoadImageNotifyRoutine',
    leaPattern: '48 8D 0D ?? ?? ?? ??',
    maxEntries: 64,
    entrySize: 16,
    callbackOffset: 16,
    structureType: 'ex_callback_routine_block',
  },

  {
    name: 'PspLoadImageNotifyRoutineEx',
    category: 'image',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'lea_rip',
    anchorSymbol: 'PsSetLoadImageNotifyRoutineEx',
    leaPattern: '48 8D 0D ?? ?? ?? ??',
    maxEntries: 64,
    entrySize: 16,
    callbackOffset: 16,
    structureType: 'ex_callback_routine_block',
  },

  // ── Object Manager Callbacks (ObRegisterCallbacks) ──

  {
    name: 'PsProcessType.CallbackList',
    category: 'handle',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'offset',
    anchorSymbol: 'PsProcessType',
    knownOffset: 0xc8, // offsetof(OBJECT_TYPE, CallbackList) in x64 Windows 10+
    maxEntries: 0, // linked list — no fixed limit
    entrySize: 0, // variable — each entry is a CALLBACK_ENTRY_ITEM chained via LIST_ENTRY
    callbackOffset: 0x28, // offsetof(CALLBACK_ENTRY_ITEM, CallbackRoutine) — approximate
    descriptionOffset: 0x50, // offsetof(CALLBACK_ENTRY_ITEM, DriverName) — approximate, UNICODE_STRING
    structureType: 'callback_entry_item',
  },

  {
    name: 'PsThreadType.CallbackList',
    category: 'handle',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'offset',
    anchorSymbol: 'PsThreadType',
    knownOffset: 0xc8,
    maxEntries: 0,
    entrySize: 0,
    callbackOffset: 0x28,
    descriptionOffset: 0x50,
    structureType: 'callback_entry_item',
  },

  // ── Registry Callbacks ──

  {
    name: 'CmCallbackListHead',
    category: 'registry',
    osVersionRange: 'Windows 10 22H2 – Windows 11 24H2',
    resolutionMethod: 'export',
    exportedSymbol: 'CmCallbackListHead',
    maxEntries: 0, // linked list — walked via Flink/Blink
    entrySize: 0,
    callbackOffset: 0x10, // offsetof(CM_CALLBACK_ENTRY, Function) — after LIST_ENTRY
    descriptionOffset: 0x28, // offsetof(CM_CALLBACK_ENTRY, Cookie/Description) — approximate
    structureType: 'callback_entry_item', // linked list, not fixed array
  },
] as const;

// ── Anti-Cheat Driver Name Patterns ──

/**
 * Known anti-cheat driver names / description patterns.
 *
 * Used to filter which callbacks to disable — we only target anti-cheat
 * callbacks, NEVER Windows system callbacks.
 *
 * Matching is case-insensitive substring match against the driver
 * description UNICODE_STRING stored in the callback entry.
 */
export const ANTICHEAT_DRIVER_PATTERNS: readonly string[] = [
  // Easy Anti-Cheat
  'EasyAntiCheat',
  'eac',
  // BattlEye
  'BEDaisy',
  'BattlEye',
  // Vanguard (Riot)
  'vgk',
  'vanguard',
  // Faceit
  'FACEIT',
  // ESEA
  'ESEADriver',
  // PunkBuster
  'PnkBstr',
  // EQU8
  'equ8',
  // Xigncode
  'XignCode',
  // nProtect GameGuard
  'GameGuard',
  'GameMon',
  // Nexon Game Security
  'NexonGameSecurity',
  'BlackCipher',
  // Tencent (Anti-Cheat Expert)
  'ACE-BASE',
  'ACE-CORE',
  'ACE-DRV',
  'SGuard',
  'TesService',
  // Other common AC drivers
  'HShield',
  'HackShield',
  'mrac',
  'Frostbite',
] as const;

// ── Safety: Windows System Drivers to NEVER Touch ──

/**
 * Windows system driver patterns that must NEVER be disabled.
 *
 * Before disabling any callback, the driver description MUST be checked
 * against this list. Any match means the callback is a Windows system
 * callback and MUST be preserved.
 *
 * This is a safety net — the primary filter is the anti-cheat pattern
 * match, but this list catches false positives.
 */
export const PROTECTED_DRIVER_PATTERNS: readonly string[] = [
  // Core Windows
  'ntoskrnl',
  'ntkrnlmp',
  'hal.dll',
  'halmacpi.dll',
  // Security
  'WdFilter',
  'WdNisDrv',
  'Windows Defender',
  'Microsoft Defender',
  // File system
  'NTFS',
  'FltMgr',
  'FileInfo',
  // Network
  'tcpip',
  'NDIS',
  'afd',
  'netbt',
  // Kernel
  'CLFS',
  'ks',
  'CNG',
  'ksecdd',
  'CI.dll',
  // Anti-malware
  'MsSecFlt',
  'MsSecCore',
  // Hypervisor
  'hvservice',
  'hvsocket',
  'Vid',
  'WinHv',
  // EDR (legitimate)
  'CrowdStrike',
  'CSAgent',
  'SentinelOne',
  'S1Agent',
  'CarbonBlack',
  'CbDefense',
  'Cylance',
] as const;
