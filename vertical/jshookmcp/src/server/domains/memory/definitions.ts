import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

const ScanValueTypeOptions = [
  'byte',
  'int8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
  'float',
  'double',
  'string',
  'hex',
  'pointer',
] as const;

const ScanCompareModeOptions = [
  'exact',
  'unknown_initial',
  'changed',
  'unchanged',
  'increased',
  'decreased',
  'greater_than',
  'less_than',
  'between',
  'not_equal',
] as const;

export const memoryScanToolDefinitions: readonly Tool[] = [
  tool('memory_first_scan', (t) =>
    t
      .desc('Start a new memory scan session.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('value', 'Value to search for (as string, e.g. "100", "3.14", "48 65 6C 6C 6F")')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type of the value')
      .number(
        'alignment',
        'Alignment in bytes (0=unaligned, 4=4-byte aligned). Default: natural alignment for the type.',
      )
      .number('maxResults', 'Maximum results to return (default: 1,000,000)')
      .prop('regionFilter', {
        type: 'object',
        properties: {
          writable: { type: 'boolean', description: 'Only scan writable regions' },
          executable: { type: 'boolean', description: 'Only scan executable regions' },
          moduleOnly: { type: 'boolean', description: 'Only scan module-backed regions' },
        },
        description: 'Filter which memory regions to scan',
      })
      .requiredOpenWorld('value', 'valueType'),
  ),
  tool('memory_next_scan', (t) =>
    t
      .desc('Narrow an existing scan session.')
      .string('sessionId', 'Scan session ID')
      .enum('mode', [...ScanCompareModeOptions], 'Comparison mode')
      .string('value', 'Target value for exact/greater_than/less_than/between/not_equal modes')
      .string('value2', 'Upper bound value for "between" mode')
      .requiredOpenWorld('sessionId', 'mode'),
  ),
  tool('memory_unknown_scan', (t) =>
    t
      .desc('Start an unknown initial value scan.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type to capture')
      .number('alignment', 'Alignment in bytes (default: natural for type)')
      .number('maxResults', 'Maximum addresses to capture (default: 5,000,000)')
      .prop('regionFilter', {
        type: 'object',
        properties: {
          writable: { type: 'boolean' },
          executable: { type: 'boolean' },
          moduleOnly: { type: 'boolean' },
        },
      })
      .requiredOpenWorld('valueType'),
  ),
  tool('memory_pointer_scan', (t) =>
    t
      .desc('Find pointers to a target address.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('targetAddress', 'Target address to find pointers to (hex, e.g. "0x7FF612340000")')
      .number('maxResults', 'Maximum results (default: 10,000)')
      .boolean('moduleOnly', 'Only scan module-backed regions')
      .required('targetAddress')
      .query()
      .openWorld(),
  ),
  tool('memory_group_scan', (t) =>
    t
      .desc('Search for multiple values at known offsets simultaneously.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .array(
        'pattern',
        {
          type: 'object',
          properties: {
            offset: { type: 'number', description: 'Byte offset from base' },
            value: { type: 'string', description: 'Expected value at offset' },
            type: {
              type: 'string',
              enum: [...ScanValueTypeOptions],
              description: 'Value type at offset',
            },
          },
          required: ['offset', 'value', 'type'],
        },
        'Array of {offset, value, type} patterns',
      )
      .number('alignment', 'Alignment for base address (default: 4)')
      .number('maxResults', 'Maximum results (default: 1,000,000)')
      .required('pattern')
      .query(),
  ),
  tool('memory_scan_session', (t) =>
    t
      .desc(
        `Manage scan sessions. Actions: list (all sessions), delete (by sessionId), export (as JSON).`,
      )
      .enum('action', ['list', 'delete', 'export'], 'Session management action')
      .string('sessionId', 'Scan session ID (required for delete/export)')
      .required('action'),
  ),

  // Pointer Chain Tools
  tool('memory_pointer_chain', (t) =>
    t
      .desc(
        `Pointer chain operations: scan (find chains to target), validate, resolve, or export as JSON.`,
      )
      .enum('action', ['scan', 'validate', 'resolve', 'export'], 'Chain operation')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('targetAddress', 'Target address hex (action=scan)')
      .number('maxDepth', 'Max chain depth 1-6 (action=scan, default: 4)')
      .number('maxOffset', 'Max offset per level in bytes (action=scan, default: 4096)')
      .boolean('staticOnly', 'Only module-relative chains (action=scan, default: false)')
      .array('modules', { type: 'string' }, 'Only scan specific modules (action=scan)')
      .number('maxResults', 'Max chains to return (action=scan, default: 1000)')
      .string('chains', 'JSON PointerChain[] (action=validate/export)')
      .string('chain', 'JSON single PointerChain (action=resolve)')
      .required('action'),
  ),

  // Structure Analysis Tools
  tool('memory_structure_analyze', (t) =>
    t
      .desc('Analyze memory at an address to infer data structure layout.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Base address of the structure (hex)')
      .number('size', 'Size to analyze in bytes (default: 256)')
      .array(
        'otherInstances',
        { type: 'string' },
        'Additional instance addresses for cross-comparison',
      )
      .boolean('parseRtti', 'Whether to attempt RTTI parsing (default: true)')
      .required('address')
      .query(),
  ),
  tool('memory_vtable_parse', (t) =>
    t
      .desc(
        'Parse a vtable to enumerate virtual function pointers and resolve them to module+offset. Also attempts ' +
          'RTTI parsing for class name and inheritance hierarchy.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('vtableAddress', 'Address of the vtable (hex)')
      .required('vtableAddress')
      .query(),
  ),
  tool('memory_structure_export_c', (t) =>
    t
      .desc(
        'Export an inferred structure as a C-style struct definition with offset comments and type annotations.',
      )
      .string('structure', 'JSON string of InferredStruct to export')
      .string('name', 'Struct name (defaults to RTTI class name or "UnknownStruct")')
      .required('structure')
      .query(),
  ),
  tool('memory_structure_compare', (t) =>
    t
      .desc(
        'Compare two structure instances to identify which fields differ (dynamic values like health/position) vs' +
          ' which are constant (vtable, type flags). Useful for finding important fields.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address1', 'First instance address (hex)')
      .string('address2', 'Second instance address (hex)')
      .number('size', 'Size to compare in bytes (default: 256)')
      .required('address1', 'address2')
      .query(),
  ),

  // Breakpoint Tools
  tool('memory_breakpoint', (t) =>
    t
      .desc(
        `Hardware breakpoint via x64 debug registers (DR0-DR3). Actions: set, remove, list, trace.`,
      )
      .enum('action', ['set', 'remove', 'list', 'trace'], 'Breakpoint operation')
      .number(
        'pid',
        'Target process ID (optional when a browser session is attached; action=set/trace)',
      )
      .string('address', 'Address hex (action=set/trace)')
      .enum('access', ['read', 'write', 'readwrite', 'execute'], 'Access type (action=set/trace)')
      .number('size', 'Watch size in bytes (action=set, default: 4)')
      .string('breakpointId', 'Breakpoint ID (action=remove)')
      .number('maxHits', 'Max hits to collect (action=trace, default: 50)')
      .number('timeoutMs', 'Timeout ms (action=trace, default: 10000)')
      .required('action')
      .destructive(),
  ),
  tool('memory_find_accesses', (t) =>
    t
      .desc(
        `Find what writes to or accesses a memory address (Cheat Engine MWT workflow). ` +
          `Sets a hardware breakpoint on the target address, auto-rearms after each hit, ` +
          `captures the faulting instruction address + context + timestamp, and optionally ` +
          `disassembles the instruction. Returns aggregated hits with per-hit instruction details.`,
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Memory address to watch (hex, e.g. "0x7FF612340000")')
      .enum(
        'mode',
        ['write', 'readwrite'],
        'Access mode: write (only writes) or readwrite (reads and writes)',
      )
      .number('size', 'Watch size in bytes: 1, 2, 4, or 8 (default: 4)')
      .number('maxHits', 'Maximum hits before auto-stop (default: 20)')
      .number('timeoutMs', 'Timeout in ms before auto-stop (default: 15000)')
      .boolean('disassemble', 'Whether to disassemble the faulting instruction (default: true)')
      .required('address', 'mode')
      .query(),
  ),

  // Injection Tools
  tool('memory_patch_bytes', (t) =>
    t
      .desc(
        'Write bytes to target process at address. Saves original bytes for undo. Use for runtime code patching.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Address to patch (hex)')
      .array('bytes', { type: 'number' }, 'Byte values to write (e.g. [0x90, 0x90])')
      .required('address', 'bytes')
      .destructive()
      .openWorld(),
  ),
  tool('memory_patch_nop', (t) =>
    t
      .desc(
        'NOP out instructions at address (replace with 0x90). Useful for disabling checks or jumps.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Address to NOP (hex)')
      .number('count', 'Number of bytes to NOP')
      .required('address', 'count')
      .destructive(),
  ),
  tool('memory_patch_undo', (t) =>
    t
      .desc('Undo a previous patch by restoring the original bytes.')
      .string('patchId', 'Patch ID to undo')
      .required('patchId')
      .destructive(),
  ),
  tool('memory_code_caves', (t) =>
    t
      .desc(
        'Find code caves (runs of 0x00 or 0xCC) in executable sections of loaded modules. Returns largest caves first.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('minSize', 'Minimum cave size in bytes (default: 16)')
      .required()
      .query(),
  ),

  // Control Tools
  tool('memory_write_value', (t) =>
    t
      .desc(
        'Write a typed value to a memory address. Supports undo/redo via memory_write_history(action=undo|redo).',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Address to write to (hex)')
      .string('value', 'Value to write (as string)')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type of the value')
      .required('address', 'value', 'valueType')
      .destructive(),
  ),
  tool('memory_freeze', (t) =>
    t
      .desc(
        `Freeze or unfreeze a memory address. Freeze continuously writes a value to prevent changes; unfreeze stops ` +
          `it.`,
      )
      .enum('action', ['freeze', 'unfreeze'], 'Freeze operation')
      .number(
        'pid',
        'Target process ID (optional when a browser session is attached; action=freeze)',
      )
      .string('address', 'Address to freeze hex (action=freeze)')
      .string('value', 'Value to maintain (action=freeze)')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type (action=freeze)')
      .number('intervalMs', 'Write interval ms (action=freeze, default: 100)')
      .string('freezeId', 'Freeze ID to remove (action=unfreeze)')
      .required('action')
      .destructive(),
  ),
  tool('memory_dump', (t) =>
    t
      .desc(
        'Dump memory region as hex with ASCII column. Outputs a formatted hex dump similar to xxd.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Start address (hex)')
      .number('size', 'Size to dump in bytes (default: 256)')
      .required('address')
      .query(),
  ),

  // Time Tools
  tool('memory_speedhack', (t) =>
    t
      .desc(
        `Hook time APIs (GetTickCount64/GetTickCount/QueryPerformanceCounter) to scale process ` +
          `time via an in-process SSE2 trampoline. Actions: apply (hook + set speed), set (adjust ` +
          `speed without re-hooking), restore (unhook and restore original functions). Speed range ` +
          `0.01–100x; values outside this range are rejected to avoid destabilising the target.`,
      )
      .enum('action', ['apply', 'set', 'restore'], 'Speedhack action')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('speed', 'Speed multiplier (0.01–100)')
      .required('action')
      .destructive(),
  ),

  // History Tools
  tool('memory_write_history', (t) =>
    t
      .desc(
        'Undo or redo the last memory write operation. Pass pid to scope the operation to a ' +
          "specific process — per-PID undo prevents reverting an unrelated process's write when " +
          'multiple processes are being edited concurrently.',
      )
      .enum('action', ['undo', 'redo'], 'History action')
      .number(
        'pid',
        'Target process ID — scopes undo/redo to this process (optional; omit for global)',
      )
      .required('action')
      .destructive()
      .openWorld(),
  ),

  // Heap Analysis Tools
  tool('memory_heap_enumerate', (t) =>
    t
      .desc(
        'Enumerate all heaps and heap blocks in a process via Toolhelp32 snapshot. Returns heap list with block ' +
          'counts, sizes, and overall statistics.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('maxBlocks', 'Maximum blocks to enumerate per heap (default: 10000)')
      .required()
      .query(),
  ),
  tool('memory_heap_stats', (t) =>
    t
      .desc(
        'Get detailed heap statistics with size distribution buckets (0-64B, 64B-1KB, 1-64KB, 64KB-1MB, >1MB), ' +
          'fragmentation ratio, and aggregate metrics.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .required()
      .query(),
  ),
  tool('memory_heap_anomalies', (t) =>
    t
      .desc(
        'Detect heap anomalies: heap spray patterns (many same-size blocks), possible use-after-free (non-zero ' +
          'free blocks), and suspicious block sizes (0 or >100MB).',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .required()
      .query(),
  ),

  // PE / Module Introspection Tools
  tool('memory_pe_headers', (t) =>
    t
      .desc(
        'Parse PE headers (DOS, NT, File, Optional) from a module base address in process memory. Returns machine' +
          ' type, entry point, image base, section count, and data directory info.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('moduleBase', 'Module base address (hex, e.g. "0x7ff612340000") — Win32')
      .string(
        'moduleName',
        'Module name/path substring (cross-platform: required on Linux/macOS to locate the on-disk ELF/Mach-O binary)',
      )
      .required()
      .query(),
  ),
  tool('memory_pe_imports_exports', (t) =>
    t
      .desc(
        'Parse import and/or export tables from a PE module in process memory. Returns DLL names, function names,' +
          ' ordinals, hints, and forwarded exports. Cross-platform: parses ELF .dynsym / Mach-O LC_SYMTAB from disk when moduleName is given on Linux/macOS.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('moduleBase', 'Module base address (hex) — Win32')
      .string('moduleName', 'Module name/path substring (cross-platform: required on Linux/macOS)')
      .enum('table', ['imports', 'exports', 'both'], 'Which table to parse', { default: 'both' })
      .required()
      .query(),
  ),
  tool('memory_inline_hook_detect', (t) =>
    t
      .desc(
        'Detect hooks in process modules. scanMode "inline" (default) compares the first 16 ' +
          'bytes of each exported function disk-vs-memory and recognises 8 hook patterns ' +
          '(JMP/CALL/short-jmp/MOV+JMP/MOV+CALL/PUSH+RET/INT3/padding). scanMode "iat" detects ' +
          'Import Address Table hooks (entries redirected outside their source module — evades ' +
          'inline detection, used by EasyHook/MinHook/Detours). scanMode "both" runs both scans.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('moduleName', 'Module name filter (optional — scans all modules if omitted)')
      .string(
        'startAddress',
        'Hex address of the code range to scan (cross-platform raw mode — required on Linux/macOS where there is no PE export table)',
      )
      .number('size', 'Byte length of the range to scan in cross-platform raw mode (default 4096)')
      .enum('scanMode', ['inline', 'iat', 'both'], 'Hook scan mode (default: inline)', {
        default: 'inline',
      })
      .required()
      .query(),
  ),

  // Anti-Cheat / Anti-Debug Tools
  tool('memory_anticheat_detect', (t) =>
    t
      .desc(
        'Scan process imports for anti-debug/anti-cheat mechanisms: IsDebuggerPresent, NtQueryInformationProcess,' +
          ' timing checks (QPC, GetTickCount), thread hiding, heap flag checks, and DR register inspection. Each ' +
          'detection includes a bypass suggestion.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .required()
      .query(),
  ),
  tool('memory_guard_pages', (t) =>
    t
      .desc(
        'Find all memory regions with PAGE_GUARD protection in a process. Guard pages are often used as ' +
          'anti-tampering mechanisms or stack overflow detection.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('maxRegions', 'Maximum regions to scan before stopping (default: 10000)')
      .required()
      .query(),
  ),
  tool('memory_integrity_check', (t) =>
    t
      .desc(
        'Check executable memory regions against their corresponding on-disk PE files (.text sections) to detect ' +
          'modifications like inline hooks or code patches.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('maxSections', 'Maximum sections to check before stopping (default: 100)')
      .required()
      .query(),
  ),

  // Region Enumeration Tool
  tool('memory_region_enumerate', (t) =>
    t
      .desc(
        'Enumerate memory regions in a target process. Cross-platform: Windows (VirtualQueryEx), ' +
          'macOS (mach_vm_region), Linux (/proc/pid/maps). Returns base address, size, protection ' +
          '(r/w/x/rw/rx/rwx), state, type (image/mapped/private), and module name (if module-backed).',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .enum(
        'protection',
        ['r', 'w', 'x', 'rw', 'rx', 'wx', 'rwx'],
        'Filter by protection (optional)',
      )
      .string(
        'moduleName',
        'Filter regions by module name (optional, case-insensitive substring match)',
      )
      .number('maxRegions', 'Maximum regions to return (default: 500)')
      .required()
      .query(),
  ),

  // AOB (Array of Bytes) Scan Tool
  tool('memory_aob_scan', (t) =>
    t
      .desc(
        'Array-of-Bytes scan with wildcard support. Search for byte patterns like ' +
          '"48 8B ?? ?? 00 00" across readable memory. Accepts hex bytes (00-FF, optional 0x prefix) ' +
          'and "??" wildcards. Case insensitive.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string(
        'pattern',
        'AOB pattern: space-separated hex bytes (00-FF) and "??" wildcards. ' +
          'Example: "48 8B ?? ?? 00 00".',
      )
      .string('moduleName', 'Restrict scan to a specific module (optional, case-insensitive)')
      .number('maxResults', 'Maximum results to return (default: 10000)')
      .required('pattern')
      .query(),
  ),

  // Minidump Parsing Tool
  tool('memory_parse_dump', (t) =>
    t
      .desc(
        'Parse a Windows Minidump (.dmp) file and extract forensic information: ' +
          'loaded modules (base/size/name/timestamp), threads (ID/stack/context), ' +
          'memory ranges (64-bit or 32-bit), system info (OS/CPU), and exception records. ' +
          'Optionally resolve a list of addresses against the dump contents. ' +
          'Pure TS — cross-platform (can analyze Windows dumps on Linux/macOS).',
      )
      .string('filePath', 'Absolute or relative path to the .dmp file')
      .boolean('includeModules', 'Include module list (default: true)', { default: true })
      .boolean('includeThreads', 'Include thread list (default: true)', { default: true })
      .boolean('includeMemoryRanges', 'Include memory ranges (default: true)', { default: true })
      .boolean('includeException', 'Include exception record (default: true)', { default: true })
      .boolean('includeSystemInfo', 'Include system information (default: true)', { default: true })
      .array(
        'resolveAddresses',
        { type: 'string' },
        'Optional list of addresses to resolve against the dump',
      )
      .required('filePath'),
  ),
];
