/**
 * Memory manifest platform filtering — unit tests.
 *
 * Verifies that Win32-only tools are correctly filtered on macOS
 * and all cross-platform tools are present.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock all native dependencies that manifest imports at module level
vi.mock('@native/MemoryScanner', () => ({ memoryScanner: {} }));
vi.mock('@native/MemoryScanSession', () => ({ scanSessionManager: {} }));
vi.mock('@native/PointerChainEngine', () => ({ pointerChainEngine: {} }));
vi.mock('@native/StructureAnalyzer', () => ({ structureAnalyzer: {} }));
vi.mock('@native/CodeInjector', () => ({ codeInjector: {} }));
vi.mock('@native/MemoryController', () => ({ memoryController: {} }));
// Win32-only engines — may not be importable on macOS
vi.mock('@native/HardwareBreakpoint', () => ({ hardwareBreakpointEngine: {} }));
vi.mock('@native/VehDebugger', () => ({ vehDebuggerEngine: {} }));
vi.mock('@native/SoftwareBreakpoint', () => ({ softwareBreakpointEngine: {} }));
vi.mock('@native/Speedhack', () => ({ speedhack: {} }));
vi.mock('@native/HeapAnalyzer', () => ({ heapAnalyzer: {} }));
vi.mock('@native/PEAnalyzer', () => ({ peAnalyzer: {} }));
vi.mock('@native/AntiCheatDetector', () => ({ antiCheatDetector: {} }));
vi.mock('@native/CrossPlatformBreakpointEngine', () => ({ crossPlatformBreakpointEngine: {} }));

const IS_WIN32 = process.platform === 'win32';

// Win32-only tools that should be absent on non-Windows platforms.
// Hardware breakpoints and find_accesses are now cross-platform.
const WIN32_ONLY_TOOLS = new Set([
  'memory_speedhack',
  'memory_mono_detect',
  'memory_mono_assemblies',
  'memory_mono_classes',
  'memory_mono_objects',
  'memory_mono_fields',
  'memory_mono_methods',
  'memory_allocate',
  'memory_free',
  'memory_inject_shellcode',
  'memory_inject_dll',
]);

// Cross-platform tools that should always be present
const CROSS_PLATFORM_TOOLS = [
  'memory_first_scan',
  'memory_next_scan',
  'memory_unknown_scan',
  'memory_pointer_scan',
  'memory_group_scan',
  'memory_scan_session',
  'memory_aob_scan',
  'memory_region_enumerate',
  'memory_pointer_chain',
  'memory_structure_analyze',
  'memory_vtable_parse',
  'memory_structure_export_c',
  'memory_structure_compare',
  'memory_patch_bytes',
  'memory_patch_nop',
  'memory_patch_undo',
  'memory_code_caves',
  'memory_write_value',
  'memory_freeze',
  'memory_dump',
  'memory_write_history',
];

async function loadManifestWithPlatform(platform?: 'win32' | 'linux' | 'darwin') {
  vi.resetModules();
  if (platform) {
    process.env.JSHOOK_REGISTRY_PLATFORM = platform;
  } else {
    delete process.env.JSHOOK_REGISTRY_PLATFORM;
  }

  const mod = await import('@server/domains/memory/manifest');
  return mod.default;
}

describe('memory manifest platform filtering', () => {
  it('should dynamically import manifest', async () => {
    const manifest = await loadManifestWithPlatform();
    expect(manifest).toBeDefined();
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.domain).toBe('memory');
  });

  it(`should have ${IS_WIN32 ? 74 : 57} tools on ${process.platform}`, async () => {
    const manifest = await loadManifestWithPlatform();
    const expected = IS_WIN32 ? 74 : 57;
    expect(manifest.registrations.length).toBe(expected);
  });

  it('should always include cross-platform tools', async () => {
    const manifest = await loadManifestWithPlatform();
    const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

    for (const tool of CROSS_PLATFORM_TOOLS) {
      expect(registeredNames.has(tool), `Missing cross-platform tool: ${tool}`).toBe(true);
    }
  });

  if (!IS_WIN32) {
    it('should exclude Win32-only tools on macOS', async () => {
      const manifest = await loadManifestWithPlatform();
      const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

      for (const tool of WIN32_ONLY_TOOLS) {
        expect(registeredNames.has(tool), `Win32-only tool present on macOS: ${tool}`).toBe(false);
      }
    });

    it('should not include Win32-only tools in workflowRule.tools', async () => {
      const manifest = await loadManifestWithPlatform();
      const workflowTools = manifest.workflowRule?.tools ?? [];

      for (const tool of workflowTools) {
        expect(WIN32_ONLY_TOOLS.has(tool), `Win32-only tool in workflowRule: ${tool}`).toBe(false);
      }
    });
  }

  if (IS_WIN32) {
    it('should include all Win32-only tools on Windows', async () => {
      const manifest = await loadManifestWithPlatform();
      const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

      for (const tool of WIN32_ONLY_TOOLS) {
        expect(registeredNames.has(tool), `Missing Win32-only tool on Windows: ${tool}`).toBe(true);
      }
    });
  }

  it('should honor registry platform override for metadata generation', async () => {
    const win32Manifest = await loadManifestWithPlatform('win32');
    const linuxManifest = await loadManifestWithPlatform('linux');

    expect(win32Manifest.registrations.length).toBe(74);
    // E5-A: +3, E5-B: +1, E5-C: +2, E5-D-heap: +3. CE parity: +2 (search_string, pointer_chain autoscan). Mono: +6 (Win32-only). Code injection: +4 (Win32-only). find_references +1. pointer_map +1. assemble +1. Minidump +1. Bookmark +2, antidetection +2 (antidetection + antidetection_check, cross-platform).
    expect(linuxManifest.registrations.length).toBe(57);
  });
});
