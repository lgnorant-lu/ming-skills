import { describe, expect, it } from 'vitest';
import manifest from '@server/domains/native-bridge/manifest';

describe('native-bridge manifest', () => {
  it('registers native bridge tools in the full profile', () => {
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.domain).toBe('native-bridge');
    expect(manifest.profiles).toEqual(['full']);

    const names = manifest.registrations.map((registration) => registration.tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'native_bridge_status',
        'ghidra_bridge',
        'ida_bridge',
        'rizin_bridge',
        'binary_ninja_bridge',
        'native_symbol_sync',
      ]),
    );
  });

  it('exposes workflow routing for native analysis backends', () => {
    expect(manifest.workflowRule?.tools).toEqual(
      expect.arrayContaining(['rizin_bridge', 'binary_ninja_bridge', 'native_symbol_sync']),
    );
    expect(manifest.prerequisites).toHaveProperty('rizin_bridge');
    expect(manifest.prerequisites).toHaveProperty('binary_ninja_bridge');
  });
});
