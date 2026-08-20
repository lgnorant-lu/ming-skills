import { describe, expect, it } from 'vitest';
import { nativeBridgeTools } from '@server/domains/native-bridge/definitions';

describe('native-bridge domain definitions', () => {
  it('should define tools array', async () => {
    expect(Array.isArray(nativeBridgeTools)).toBe(true);
  });
  it('should have valid tool shapes', async () => {
    for (const tool of nativeBridgeTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('exposes parity actions for IDA and Ghidra bridge tools', async () => {
    const ghidra = nativeBridgeTools.find((tool) => tool.name === 'ghidra_bridge');
    const ida = nativeBridgeTools.find((tool) => tool.name === 'ida_bridge');
    const rizin = nativeBridgeTools.find((tool) => tool.name === 'rizin_bridge');
    const binaryNinja = nativeBridgeTools.find((tool) => tool.name === 'binary_ninja_bridge');

    expect(ghidra).toBeDefined();
    expect(ida).toBeDefined();
    expect(rizin).toBeDefined();
    expect(binaryNinja).toBeDefined();

    const ghidraProperties = ghidra!.inputSchema.properties as Record<string, unknown>;
    const idaProperties = ida!.inputSchema.properties as Record<string, unknown>;
    const rizinProperties = rizin!.inputSchema.properties as Record<string, unknown>;
    const binaryNinjaProperties = binaryNinja!.inputSchema.properties as Record<string, unknown>;
    const ghidraActions = (ghidraProperties['action'] as { enum?: string[] }).enum;
    const idaActions = (idaProperties['action'] as { enum?: string[] }).enum;
    const rizinActions = (rizinProperties['action'] as { enum?: string[] }).enum;
    const binaryNinjaActions = (binaryNinjaProperties['action'] as { enum?: string[] }).enum;

    expect(ghidraActions).toEqual(expect.arrayContaining(['search_strings', 'get_segments']));
    expect(idaActions).toEqual(expect.arrayContaining(['search_strings', 'get_segments']));
    expect(rizinActions).toEqual(
      expect.arrayContaining(['run_command', 'disassemble_function', 'get_segments']),
    );
    expect(binaryNinjaActions).toEqual(
      expect.arrayContaining(['decompile_function', 'disassemble_function', 'get_types']),
    );
    expect(idaProperties).toHaveProperty('searchPattern');
  });

  it('allows all native bridge backends in status and symbol sync schemas', async () => {
    const status = nativeBridgeTools.find((tool) => tool.name === 'native_bridge_status');
    const sync = nativeBridgeTools.find((tool) => tool.name === 'native_symbol_sync');
    const statusBackend = status!.inputSchema.properties!['backend'] as { enum?: string[] };
    const syncSource = sync!.inputSchema.properties!['source'] as { enum?: string[] };

    expect(statusBackend.enum).toEqual(
      expect.arrayContaining(['ghidra', 'ida', 'rizin', 'binaryninja', 'all']),
    );
    expect(syncSource.enum).toEqual(
      expect.arrayContaining(['ghidra', 'ida', 'rizin', 'binaryninja']),
    );
  });
});
