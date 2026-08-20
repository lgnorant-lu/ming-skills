import type { HeapAnalyzer } from '@native/HeapAnalyzer';
import type { PEAnalyzer } from '@native/PEAnalyzer';
import type { AntiCheatDetector } from '@native/AntiCheatDetector';
import type { Speedhack } from '@native/Speedhack';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argNumber, argString } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { requireNumberInRangeArg, validateHexAddress } from './validation';

import { createPlatformProvider } from '@native/platform/factory';
import type { PlatformMemoryAPI } from '@native/platform/PlatformMemoryAPI';
import { scanGuardPages as crossPlatformScanGuardPages } from '@native/platform/GuardPageScanner';
import { scanIntegrity as crossPlatformScanIntegrity } from '@native/platform/IntegrityScanner';
import { scanRangeForHooks } from '@native/platform/HookPatternScanner';
import { parseElfHeader, parseElfSections, parseElfSymbols } from '@native/platform/ElfParser';
import {
  parseMachOHeader,
  parseMachoSections,
  parseMachOSymbols,
} from '@native/platform/MachOParser';

const TOOL_SPEEDHACK = 'memory_speedhack';
const TOOL_GUARD_PAGES = 'memory_guard_pages';
const TOOL_INTEGRITY_CHECK = 'memory_integrity_check';

/** Speedhack multiplier bounds — outside this range the target process can hang or crash. */
const SPEEDHACK_MIN_SPEED = 0.01;
const SPEEDHACK_MAX_SPEED = 100;

const PE_TABLE_OPTIONS = new Set<'imports' | 'exports' | 'both'>(['imports', 'exports', 'both']);
const HOOK_SCAN_MODES = new Set<'inline' | 'iat' | 'both'>(['inline', 'iat', 'both']);

function getPlatformApi(): PlatformMemoryAPI | null {
  try {
    return createPlatformProvider();
  } catch (err) {
    // Fail-soft: native platform provider may be unavailable (non-Win32 koffi
    // module absent, ABI mismatch, etc.). Down-tools degrade to per-handler
    // fallbacks; log so the absence isn't silent.
    logger.debug(
      `memory: platform memory provider unavailable (${err instanceof Error ? err.message : String(err)}); using per-handler fallbacks`,
    );
    return null;
  }
}

export class IntegrityHandlers {
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(
    private readonly speedhackEngine: Speedhack | null,
    private readonly heapAnalyzer: HeapAnalyzer | null,
    private readonly peAnalyzer: PEAnalyzer | null,
    private readonly antiCheatDetector: AntiCheatDetector | null,
    private readonly processManager?: UnifiedProcessManager,
    private readonly ctx?: MCPServerContext,
    auditTrail?: MemoryAuditTrail | null,
  ) {
    this.auditTrail = auditTrail ?? null;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  private recordAudit(entry: {
    operation: string;
    pid: number | null;
    address: string | null;
    size: number | null;
    result: 'success' | 'failure';
    error?: string;
    durationMs: number;
  }): void {
    if (!this.auditTrail) return;
    try {
      this.auditTrail.record(entry);
    } catch (auditError) {
      logger.warn('Memory audit trail recording failed:', auditError);
    }
  }

  async handleSpeedhackApply(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.speedhackEngine) {
        throw new Error(
          'Speedhack tools (memory_speedhack) are only supported on Windows. ' +
            'This tool requires Win32 timer manipulation APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const speed = requireNumberInRangeArg(
        args.speed,
        'speed',
        TOOL_SPEEDHACK,
        SPEEDHACK_MIN_SPEED,
        SPEEDHACK_MAX_SPEED,
      );
      const start = Date.now();
      try {
        const result = await this.speedhackEngine.apply(pid, speed);
        this.recordAudit({
          operation: 'speedhack_apply',
          pid,
          address: null,
          size: null,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          ...result,
          hint: `Speedhack active (${speed}x). Use memory_speedhack({ action: 'set' }) to adjust, or action: 'restore' to unhook.`,
        };
      } catch (e) {
        this.recordAudit({
          operation: 'speedhack_apply',
          pid,
          address: null,
          size: null,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleSpeedhackSet(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.speedhackEngine) {
        throw new Error(
          'Speedhack tools (memory_speedhack) are only supported on Windows. ' +
            'This tool requires Win32 timer manipulation APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const speed = requireNumberInRangeArg(
        args.speed,
        'speed',
        TOOL_SPEEDHACK,
        SPEEDHACK_MIN_SPEED,
        SPEEDHACK_MAX_SPEED,
      );
      const start = Date.now();
      try {
        const updated = await this.speedhackEngine.setSpeed(pid, speed);
        this.recordAudit({
          operation: 'speedhack_set',
          pid,
          address: null,
          size: null,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return { updated, newSpeed: speed };
      } catch (e) {
        this.recordAudit({
          operation: 'speedhack_set',
          pid,
          address: null,
          size: null,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleSpeedhackRestore(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.speedhackEngine) {
        throw new Error(
          'Speedhack tools (memory_speedhack) are only supported on Windows. ' +
            'This tool requires Win32 timer manipulation APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const start = Date.now();
      try {
        const restored = await this.speedhackEngine.restore(pid);
        this.recordAudit({
          operation: 'speedhack_restore',
          pid,
          address: null,
          size: null,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          restored,
          hint: restored
            ? 'Speedhack removed and original time APIs restored.'
            : 'No active speedhack for this process.',
        };
      } catch (e) {
        this.recordAudit({
          operation: 'speedhack_restore',
          pid,
          address: null,
          size: null,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleHeapEnumerate(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const result = await this.heapAnalyzer!.enumerateHeaps(pid);
      return {
        ...result,
        hint: `Enumerated ${result.heaps.length} heaps. Use memory_heap_stats for statistics or memory_heap_anomalies to check for issues.`,
      };
    });
  }

  async handleHeapStats(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      return { ...(await this.heapAnalyzer!.getStats(pid)) };
    });
  }

  async handleHeapAnomalies(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const anomalies = await this.heapAnalyzer!.detectAnomalies(pid);
      return {
        anomalies,
        count: anomalies.length,
        hint:
          anomalies.length > 0
            ? `Found ${anomalies.length} anomalies — inspect types for spray, UAF, or suspicious patterns.`
            : 'No heap anomalies detected.',
      };
    });
  }

  async handlePEHeaders(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);

      // Win32 fast path — PEAnalyzer reads the in-memory PE header by base addr.
      if (this.peAnalyzer) {
        const moduleBase = validateHexAddress(args.moduleBase, 'moduleBase');
        const headers = await this.peAnalyzer.parseHeaders(pid, moduleBase);
        let sections: unknown[] = [];
        try {
          sections = await this.peAnalyzer.listSections(pid, moduleBase);
        } catch {
          // best-effort: section enumeration failure does not invalidate headers
        }
        return { ...headers, sections };
      }

      // Cross-platform fallback — parse ELF/Mach-O header from the on-disk
      // binary. Unlike PE (which is parsed from process memory by base address),
      // ELF/Mach-O need the module's disk path, so callers must supply moduleName
      // (a substring of the module path as reported by enumerateModules).
      const moduleName = argString(args, 'moduleName');
      if (!moduleName) {
        throw new Error(
          `memory_pe_headers on ${process.platform} requires 'moduleName' (a substring ` +
            `of the module path). Win32 PE uses in-memory 'moduleBase'; ELF/Mach-O parse ` +
            `the on-disk binary so they need the file path.`,
        );
      }
      const api = getPlatformApi();
      if (!api) {
        throw new Error(`memory_pe_headers: no platform memory provider on ${process.platform}.`);
      }
      const isElf = api.platform === 'linux';
      const isMacho = api.platform === 'darwin';
      if (!isElf && !isMacho) {
        throw new Error(
          `memory_pe_headers: unsupported platform ${process.platform} (need Win32 PEAnalyzer or Linux/macOS ELF/Mach-O).`,
        );
      }
      const handle = api.openProcess(pid, false);
      try {
        const mods = api.enumerateModules(handle);
        const mod = (mods as Array<{ name: string; baseAddress: bigint }>).find((m) =>
          m.name.toLowerCase().includes(moduleName.toLowerCase()),
        );
        if (!mod) {
          throw new Error(`memory_pe_headers: no loaded module matches '${moduleName}'.`);
        }
        const path = mod.name;
        const header = isElf ? parseElfHeader(path) : parseMachOHeader(path);
        const sections = isElf ? parseElfSections(path) : parseMachoSections(path);
        if (!header) {
          throw new Error(
            `memory_pe_headers: '${path}' is not a recognised ${isElf ? 'ELF64' : 'Mach-O 64'} binary.`,
          );
        }
        return {
          format: isElf ? 'elf64' : 'mach-o-64',
          moduleName: path.split('/').pop() ?? path,
          moduleBase: `0x${mod.baseAddress.toString(16)}`,
          ...header,
          sections,
          platformNote: `Parsed on-disk ${isElf ? 'ELF' : 'Mach-O'} (Win32 PE in-memory parse not available on ${api.platform}).`,
        };
      } finally {
        api.closeProcess(handle);
      }
    });
  }

  async handlePEImportsExports(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const table = argEnum(args, 'table', PE_TABLE_OPTIONS, 'both');
      const pid = await this.resolvePid(args.pid);

      // Win32 fast path — PEAnalyzer parses the in-memory import/export tables.
      if (this.peAnalyzer) {
        const base = validateHexAddress(args.moduleBase, 'moduleBase');
        const result: Record<string, unknown> = {};
        if (table === 'imports' || table === 'both') {
          result.imports = await this.peAnalyzer.parseImports(pid, base);
        }
        if (table === 'exports' || table === 'both') {
          result.exports = await this.peAnalyzer.parseExports(pid, base);
        }
        return result;
      }

      // Cross-platform fallback — ELF .dynsym / Mach-O LC_SYMTAB from disk.
      const moduleName = argString(args, 'moduleName');
      if (!moduleName) {
        throw new Error(`memory_pe_imports_exports on ${process.platform} requires 'moduleName'.`);
      }
      const api = getPlatformApi();
      if (!api) {
        throw new Error(
          `memory_pe_imports_exports: no platform memory provider on ${process.platform}.`,
        );
      }
      const isElf = api.platform === 'linux';
      const isMacho = api.platform === 'darwin';
      if (!isElf && !isMacho) {
        throw new Error(`memory_pe_imports_exports: unsupported platform ${process.platform}.`);
      }
      const handle = api.openProcess(pid, false);
      try {
        const mods = api.enumerateModules(handle);
        const mod = (mods as Array<{ name: string; baseAddress: bigint }>).find((m) =>
          m.name.toLowerCase().includes(moduleName.toLowerCase()),
        );
        if (!mod) {
          throw new Error(`memory_pe_imports_exports: no loaded module matches '${moduleName}'.`);
        }
        const path = mod.name;
        const symtab = isElf ? parseElfSymbols(path) : parseMachOSymbols(path);
        const result: Record<string, unknown> = {};
        if (table === 'imports' || table === 'both') {
          result.imports = symtab.imports;
        }
        if (table === 'exports' || table === 'both') {
          result.exports = symtab.exports;
        }
        result.format = isElf ? 'elf64-dynsym' : 'mach-o-nlist';
        result.moduleName = path.split('/').pop() ?? path;
        result.platformNote = `Parsed on-disk ${isElf ? 'ELF .dynsym' : 'Mach-O LC_SYMTAB'} (undefined=import, defined external=export).`;
        return result;
      } finally {
        api.closeProcess(handle);
      }
    });
  }

  async handleInlineHookDetect(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const moduleName = argString(args, 'moduleName');
      const scanMode = argEnum(args, 'scanMode', HOOK_SCAN_MODES, 'inline');

      // Win32 fast path — PEAnalyzer (export-prologue disk-vs-memory comparison)
      if (this.peAnalyzer) {
        // inline mode: compare export prologues disk-vs-memory.
        // iat mode: compare IAT entries against source-module ranges.
        // both: run the two scans (independent — no shared state).
        const inlineHooks =
          scanMode === 'iat' ? [] : await this.peAnalyzer.detectInlineHooks(pid, moduleName);
        const iatHooks =
          scanMode === 'inline' ? [] : await this.peAnalyzer.detectIATHooks(pid, moduleName);

        const total = inlineHooks.length + iatHooks.length;
        return {
          inlineHooks,
          iatHooks,
          count: total,
          scanMode,
          hint:
            total > 0
              ? `Detected ${inlineHooks.length} inline + ${iatHooks.length} IAT hooks. Check hookType/jumpTarget (inline) and actualModule (IAT) for each.`
              : `No hooks detected (scanMode=${scanMode}). Exports match disk and IAT entries resolve within their source modules.`,
        };
      }

      // Cross-platform fallback — raw byte-pattern scan via PlatformMemoryAPI.
      // Without a PE export table (or ELF/Mach-O symbol resolution, which is
      // E5-C), the scanner cannot do per-function disk-vs-memory comparison.
      // Instead it sweeps an explicit address range and reports high-confidence
      // hook patterns (FF25 / mov_jmp / mov_call / push_ret — rare in clean
      // compiler output). The caller supplies startAddress + size; without them
      // the tool returns guidance rather than guessing.
      if (scanMode === 'iat') {
        return {
          inlineHooks: [],
          iatHooks: [],
          count: 0,
          scanMode,
          platformNote:
            `IAT hook detection requires PE import-table parsing (Windows-only). ` +
            `On ${process.platform} use scanMode='inline' with an explicit startAddress+size for a raw pattern sweep.`,
          hint: 'IAT scan is Windows-only; switch to scanMode=inline for cross-platform raw pattern detection.',
        };
      }
      const startAddressStr = argString(args, 'startAddress');
      const size = argNumber(args, 'size', 4096);
      if (!startAddressStr) {
        return {
          inlineHooks: [],
          iatHooks: [],
          count: 0,
          scanMode,
          platformNote:
            `Cross-platform inline-hook scan on ${process.platform} needs an explicit ` +
            `startAddress (hex) + optional size (default 4096). Without a PE export table ` +
            `the scanner does a raw byte-pattern sweep of the given range and reports ` +
            `high-confidence hook patterns (FF25/mov_jmp/mov_call/push_ret).`,
          hint: 'Provide startAddress (hex) and optional size to scan a specific code range.',
        };
      }
      validateHexAddress(startAddressStr, 'startAddress');
      const normalized = startAddressStr.startsWith('0x')
        ? startAddressStr
        : `0x${startAddressStr}`;
      const startAddr = BigInt(normalized);

      const api = getPlatformApi();
      if (!api) {
        throw new Error(
          'memory_inline_hook_detect: no platform memory provider is available on ' +
            `${process.platform}. Provide startAddress + size for a raw byte-pattern scan.`,
        );
      }
      const handle = api.openProcess(pid, false);
      try {
        const memResult = api.readMemory(handle, startAddr, size);
        const matches = scanRangeForHooks(new Uint8Array(memResult.data), startAddr);
        const inlineHooks = matches.map((m) => ({
          address: m.address,
          moduleName: moduleName ?? `raw-scan@0x${startAddr.toString(16)}`,
          functionName: `<offset+0x${m.offset.toString(16)}>`,
          originalBytes: [] as number[], // raw scan — no disk comparison
          currentBytes: m.matchedBytes,
          hookType: m.hookType,
          jumpTarget: m.jumpTarget,
        }));
        return {
          inlineHooks,
          iatHooks: [],
          count: inlineHooks.length,
          scanMode,
          platformNote:
            `Raw byte-pattern scan on ${api.platform} (${size} bytes from 0x${startAddr.toString(16)}). ` +
            `Reports high-confidence patterns only (FF25/mov_jmp/mov_call/push_ret); jmp_rel32/call_rel32 ` +
            `are common in legitimate code and are suppressed without disk comparison. ` +
            `Provide confidence via the raw bytes if you need the full set.`,
          hint:
            inlineHooks.length > 0
              ? `Found ${inlineHooks.length} high-confidence hook pattern(s). Each is rare in clean compiler output — investigate jumpTarget.`
              : `No high-confidence hook patterns in the scanned range. (Legitimate jmp/call instructions are not reported without disk comparison.)`,
        };
      } finally {
        api.closeProcess(handle);
      }
    });
  }

  async handleAntiCheatDetect(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);

      // Windows fast path
      if (this.antiCheatDetector) {
        const detections = await this.antiCheatDetector.detect(pid);
        return {
          detections,
          count: detections.length,
          limitations: [
            'Import-only API detection: anti-debug resolved at runtime via GetModuleHandle+GetProcAddress or manual syscalls is not surfaced by the import scan (the RDTSC instruction pass mitigates this partially).',
            'Kernel-mode anti-cheat drivers are NOT enumerated — this scanner is user-mode only and cannot inspect driver callbacks.',
            'Direct PEB.BeingDebugged / PEB.NtGlobalFlag reads without calling the corresponding API are not detected.',
          ],
          hint:
            detections.length > 0
              ? `Found ${detections.length} anti-debug mechanisms. Each includes a bypassSuggestion. See "limitations" for detection boundaries.`
              : 'No anti-debug mechanisms detected in imports or timing instructions. See "limitations" for what this scanner cannot catch.',
        };
      }

      // Cross-platform fallback
      return {
        detections: [],
        count: 0,
        platformNote:
          `Anti-cheat import scanning is Windows-only (current platform: ${process.platform}). ` +
          'The import-table analysis requires PE parsing of loaded modules; use memory_region_enumerate and memory_integrity_check for cross-platform code inspection.',
        limitations: [
          'Anti-cheat detection on non-Windows platforms is limited to memory-integrity checks (memory_integrity_check) and guard-page scanning (memory_guard_pages) — both work on Linux and macOS.',
          'Import-table analysis (kernel32/ntdll API enumeration) is Windows-only.',
          'Kernel driver enumeration and ETW provider inspection are out of scope for a user-mode tool.',
        ],
        hint: 'On this platform use memory_integrity_check to compare code sections against disk, and memory_guard_pages to detect anti-tamper guards. Import-table scans require Windows.',
      };
    });
  }

  async handleGuardPages(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const maxRegions = argNumber(args, 'maxRegions', 10000);
      if (!Number.isFinite(maxRegions) || maxRegions <= 0) {
        throw new Error(
          `${TOOL_GUARD_PAGES}: argument "maxRegions" must be a positive number, got: ${JSON.stringify(args.maxRegions)}`,
        );
      }

      // Win32 fast path — AntiCheatDetector (koffi/VirtualQueryEx)
      if (this.antiCheatDetector) {
        const result = await this.antiCheatDetector.scanGuardPages(pid);
        const { guardPages, stats } = result;
        const truncated = guardPages.length > maxRegions;
        const filtered = truncated ? guardPages.slice(0, maxRegions) : guardPages;
        return {
          guardPages: filtered,
          count: filtered.length,
          scan: stats,
          truncated: truncated || stats.truncated,
          hint:
            truncated || stats.truncated
              ? `Scan stopped after ${truncated ? maxRegions : stats.scannedRegions} regions${truncated ? ' (maxRegions limit)' : ''} in ${stats.durationMs}ms to avoid hanging. Results may be partial.`
              : guardPages.length > 0
                ? `Found ${guardPages.length} guard page regions — these may indicate anti-tampering.`
                : 'No guard pages found.',
        };
      }

      // Cross-platform fallback — PlatformMemoryAPI (works on Linux/macOS too)
      const api = getPlatformApi();
      if (!api) {
        throw new Error(
          `${TOOL_GUARD_PAGES}: no platform memory provider is available on ${process.platform}. ` +
            'This tool requires a native memory backend.',
        );
      }
      const result = await crossPlatformScanGuardPages(api, pid, maxRegions, 2000);
      const { guardPages, stats } = result;
      return {
        guardPages,
        count: guardPages.length,
        scan: stats,
        truncated: stats.truncated,
        platformNote: `Platform: ${api.platform}. Guard-page detection uses VirtualQueryEx / /proc/pid/maps / mach_vm_region (vendor-specific PAGE_GUARD flags are Windows-only).`,
        hint:
          guardPages.length > 0
            ? `Found ${guardPages.length} guard-page regions.`
            : `No guard pages found (platform: ${api.platform}). System-level guard pages on non-Windows platforms are rare — most anti-tampering uses mprotect or mach_vm_protect directly.`,
      };
    });
  }

  async handleIntegrityCheck(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const maxSections = argNumber(args, 'maxSections', 100);
      if (!Number.isFinite(maxSections) || maxSections <= 0) {
        throw new Error(
          `${TOOL_INTEGRITY_CHECK}: argument "maxSections" must be a positive number, got: ${JSON.stringify(args.maxSections)}`,
        );
      }
      const moduleName = argString(args, 'moduleName');

      // Win32 fast path — AntiCheatDetector (PE comparison, koffi)
      if (this.antiCheatDetector) {
        const result = await this.antiCheatDetector.scanIntegrity(pid, moduleName);
        const { sections, stats } = result;
        const truncated = sections.length > maxSections;
        const filtered = truncated ? sections.slice(0, maxSections) : sections;
        const filteredModified = filtered.filter((r) => r.isModified);
        return {
          sections: filtered,
          totalChecked: filtered.length,
          modifiedCount: filteredModified.length,
          scan: stats,
          truncated: truncated || stats.truncated,
          hint:
            truncated || stats.truncated
              ? `Checked ${stats.scannedSections} executable section(s)${truncated ? ` (maxSections limit: ${maxSections})` : ''} across ${stats.scannedModules} module(s) before hitting safety limits. Results may be partial.`
              : filteredModified.length > 0
                ? `${filteredModified.length} section(s) modified — code may have been patched or hooked.`
                : 'All checked sections match disk — no runtime modifications detected.',
        };
      }

      // Cross-platform fallback — ELF/Mach-O vs memory comparison
      const api = getPlatformApi();
      if (!api) {
        throw new Error(
          `${TOOL_INTEGRITY_CHECK}: no platform memory provider is available on ${process.platform}.`,
        );
      }
      const result = await crossPlatformScanIntegrity(api, pid, moduleName);
      const { sections, stats } = result;
      const truncated = sections.length > maxSections;
      const filtered = truncated ? sections.slice(0, maxSections) : sections;
      const filteredModified = filtered.filter((r) => r.isModified);
      return {
        sections: filtered,
        totalChecked: filtered.length,
        modifiedCount: filteredModified.length,
        scan: stats,
        truncated: truncated || stats.truncated,
        platformNote: `Platform: ${api.platform}. Integrity comparison uses on-disk ELF (Linux) or Mach-O (macOS) section headers vs in-memory bytes read via PlatformMemoryAPI.`,
        hint:
          filteredModified.length > 0
            ? `${filteredModified.length} section(s) modified — code may have been patched or hooked.`
            : sections.length > 0
              ? 'All checked sections match disk — no runtime modifications detected.'
              : `No loadable sections found to compare (platform: ${api.platform}). Use memory_region_enumerate to inspect loaded code segments.`,
      };
    });
  }
}
