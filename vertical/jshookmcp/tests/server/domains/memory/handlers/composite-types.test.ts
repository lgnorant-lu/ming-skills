import { describe, it, expect } from 'vitest';
import {
  exportCSharpStruct,
  exportRustStruct,
  detectCompositeTypes,
  setTypeOverride,
  getTypeOverride,
  clearTypeOverrides,
  listTypeOverrides,
} from '../../../../../src/server/domains/memory/handlers/composite-types';
import {
  signCheatTable,
  verifyCheatTable,
} from '../../../../../src/server/domains/memory/handlers/cheat-table-sign';
import {
  detectEmulator,
  getEmulatorMemoryLayout,
  listKnownEmulators,
} from '../../../../../src/server/domains/memory/handlers/emulator';
import type { InferredStruct } from '@native/StructureAnalyzer.types';

// ── Feature 1: Rich Type System ──

describe('composite-types — Rust export', () => {
  it('exports a simple struct as Rust #[repr(C)]', () => {
    const struct: InferredStruct = {
      baseAddress: '0x0',
      totalSize: 16,
      fields: [
        { offset: 0, size: 8, type: 'vtable_ptr', name: 'vtable', confidence: 1, value: '' },
        { offset: 8, size: 4, type: 'int32', name: 'health', confidence: 0.9, value: '100' },
        { offset: 12, size: 4, type: 'float', name: 'speed', confidence: 0.8, value: '3.14' },
      ],
      timestamp: Date.now(),
    };
    const result = exportRustStruct(struct, 'Player');
    expect(result).toContain('#[repr(C)]');
    expect(result).toContain('pub struct Player');
    expect(result).toContain('pub vtable: usize');
    expect(result).toContain('pub health: i32');
    expect(result).toContain('pub speed: f32');
  });

  it('emits padding for gaps between fields', () => {
    const struct: InferredStruct = {
      baseAddress: '0x0',
      totalSize: 16,
      fields: [
        { offset: 0, size: 4, type: 'int32', name: 'id', confidence: 1, value: '1' },
        { offset: 8, size: 8, type: 'pointer', name: 'ptr', confidence: 1, value: '0x0' },
      ],
      timestamp: Date.now(),
    };
    const result = exportRustStruct(struct, 'TestGap');
    expect(result).toContain('_pad_4');
    expect(result).toContain('[u8; 4]');
    expect(result).toContain('pub id: i32');
    expect(result).toContain('pub ptr: usize');
  });
});

describe('composite-types — C# export', () => {
  it('exports a simple struct with [StructLayout] and [FieldOffset]', () => {
    const struct: InferredStruct = {
      baseAddress: '0x0',
      totalSize: 16,
      fields: [
        { offset: 0, size: 8, type: 'vtable_ptr', name: 'vtable', confidence: 1, value: '' },
        { offset: 8, size: 4, type: 'float', name: 'x', confidence: 0.9, value: '1.0' },
        { offset: 12, size: 4, type: 'float', name: 'y', confidence: 0.9, value: '2.0' },
      ],
      timestamp: Date.now(),
    };
    const result = exportCSharpStruct(struct, 'Vector2D');
    expect(result).toContain('using System.Runtime.InteropServices;');
    expect(result).toContain('[StructLayout(LayoutKind.Explicit, Size = 16)]');
    expect(result).toContain('public struct Vector2D');
    expect(result).toContain('[FieldOffset(0x0)]');
    expect(result).toContain('public nint vtable;');
    expect(result).toContain('[FieldOffset(0x8)]');
    expect(result).toContain('public float x;');
    expect(result).toContain('[FieldOffset(0xC)]');
    expect(result).toContain('public float y;');
  });
});

describe('composite-types — composite detection', () => {
  it('detects Vector3 (3 consecutive floats with vector-like names)', () => {
    const fields = [
      { offset: 0, size: 4, type: 'float', name: 'x', value: '1.0' },
      { offset: 4, size: 4, type: 'float', name: 'y', value: '2.0' },
      { offset: 8, size: 4, type: 'float', name: 'z', value: '3.0' },
    ];
    const results = detectCompositeTypes(fields);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const vec3 = results.find((r) => r.suggestedType === 'Vector3');
    expect(vec3).toBeDefined();
    expect(vec3!.offset).toBe(0);
    expect(vec3!.size).toBe(12);
    expect(vec3!.elementCount).toBe(3);
  });

  it('detects Matrix4x4 (16 consecutive floats)', () => {
    const fields: Array<{
      offset: number;
      size: number;
      type: string;
      name: string;
      value: string;
    }> = [];
    for (let i = 0; i < 16; i++) {
      fields.push({ offset: i * 4, size: 4, type: 'float', name: `m${i}`, value: '0' });
    }
    const results = detectCompositeTypes(fields);
    const mat = results.find((r) => r.suggestedType === 'Matrix4x4');
    expect(mat).toBeDefined();
    expect(mat!.offset).toBe(0);
    expect(mat!.size).toBe(64);
    expect(mat!.elementCount).toBe(16);
  });

  it('detects consecutive pointer arrays (null-terminated pattern)', () => {
    const fields = [
      { offset: 0, size: 8, type: 'pointer', name: 'fn_0', value: '0x1000' },
      { offset: 8, size: 8, type: 'pointer', name: 'fn_1', value: '0x2000' },
      { offset: 16, size: 8, type: 'pointer', name: 'fn_2', value: '0x3000' },
      { offset: 24, size: 8, type: 'pointer', name: 'fn_3', value: '0x4000' },
      { offset: 32, size: 8, type: 'pointer', name: 'fn_4', value: '0x0' },
    ];
    const results = detectCompositeTypes(fields);
    const arr = results.find((r) => r.suggestedType === 'pointer_array_5');
    expect(arr).toBeDefined();
    expect(arr!.offset).toBe(0);
    expect(arr!.size).toBe(40);
  });
});

describe('composite-types — type overrides', () => {
  it('sets and gets type overrides', () => {
    clearTypeOverrides();
    setTypeOverride(0, 4, 'float');
    expect(getTypeOverride(0, 4)).toBe('float');
    expect(getTypeOverride(4, 4)).toBeUndefined();
  });

  it('lists all overrides', () => {
    clearTypeOverrides();
    setTypeOverride(0, 4, 'float');
    setTypeOverride(8, 8, 'pointer');
    const overrides = listTypeOverrides();
    expect(overrides.length).toBe(2);
    expect(overrides).toEqual(
      expect.arrayContaining([
        { offset: 0, size: 4, type: 'float' },
        { offset: 8, size: 8, type: 'pointer' },
      ]),
    );
  });

  it('clearTypeOverrides removes all', () => {
    setTypeOverride(0, 4, 'float');
    clearTypeOverrides();
    expect(listTypeOverrides().length).toBe(0);
  });
});

// ── Feature 2: Group Structure Comparison ──
// (Handler-level tests in structure.test.ts)

// ── Feature 3: Cheat Table Signing ──

describe('cheat-table-sign', () => {
  const testXml =
    '<?xml version="1.0"?>\n<CheatTable>\n  <CheatEntries>\n    <CheatEntry><Description>"Health"</Description><Address>0x1234</Address></CheatEntry>\n  </CheatEntries>\n</CheatTable>';

  it('signs a cheat table XML with HMAC-SHA256', async () => {
    const result = await signCheatTable(testXml, {
      secret: 'test-secret-key-123',
      signer: 'test-signer',
    });
    expect(result.success).toBe(true);
    expect(result.signature).toBeDefined();
    expect(result.signature!.length).toBe(64); // SHA256 hex = 64 chars
    expect(result.signer).toBe('test-signer');
    expect(result.signedXml).toBeDefined();
    expect(result.signedXml!).toContain('<Signature');
    expect(result.signedXml!).toContain('signer="test-signer"');
  });

  it('verifies a valid signed table', async () => {
    const signResult = await signCheatTable(testXml, {
      secret: 'test-secret-key-123',
      signer: 'test-signer',
    });
    expect(signResult.success).toBe(true);
    const verifyResult = await verifyCheatTable(signResult.signedXml!, {
      secret: 'test-secret-key-123',
    });
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.signer).toBe('test-signer');
  });

  it('rejects a tampered table', async () => {
    const signResult = await signCheatTable(testXml, {
      secret: 'test-secret-key-123',
      signer: 'test-signer',
    });
    expect(signResult.success).toBe(true);
    const tampered = signResult.signedXml!.replace('0x1234', '0x5678');
    const verifyResult = await verifyCheatTable(tampered, {
      secret: 'test-secret-key-123',
    });
    expect(verifyResult.valid).toBe(false);
  });

  it('fails sign without a secret', async () => {
    const result = await signCheatTable(testXml, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('No signing secret');
  });

  it('rejects verify on unsigned XML', async () => {
    const result = await verifyCheatTable(testXml, {
      secret: 'test-secret-key-123',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No <Signature>');
  });
});

// ── Feature 4: Emulator Memory Search ──

describe('emulator — detection', () => {
  it('detects PCSX2 by process name', () => {
    const result = detectEmulator('pcsx2-qt.exe');
    expect(result.isEmulator).toBe(true);
    expect(result.emulatorName).toBe('PCSX2');
    expect(result.platform).toBe('PlayStation 2');
    expect(result.memoryRegions!.length).toBeGreaterThan(0);
    expect(result.memoryRegions![0]!.name).toBe('EE_RAM');
  });

  it('detects Dolphin by process name', () => {
    const result = detectEmulator('dolphin-emu.exe');
    expect(result.isEmulator).toBe(true);
    expect(result.emulatorName).toBe('Dolphin');
    expect(result.platform).toBe('GameCube / Wii');
    expect(result.memoryRegions!.length).toBeGreaterThan(0);
    expect(result.memoryRegions!.some((r) => r.name === 'MEM1')).toBe(true);
    expect(result.memoryRegions!.some((r) => r.name === 'MEM2')).toBe(true);
  });

  it('detects with module fingerprint confirmation', () => {
    const result = detectEmulator('rpcs3x64.exe', ['rpcs3', 'cell', 'sys']);
    expect(result.isEmulator).toBe(true);
    expect(result.emulatorName).toBe('RPCS3');
    expect(result.matchedBy!.length).toBeGreaterThanOrEqual(2);
    expect(result.matchedBy![1]).toContain('module fingerprint');
  });

  it('returns isEmulator=false for unknown process', () => {
    const result = detectEmulator('notepad.exe');
    expect(result.isEmulator).toBe(false);
    expect(result.hint).toBeDefined();
  });

  it('lists all known emulators', () => {
    const list = listKnownEmulators();
    expect(list.length).toBe(8);
    expect(list.some((e) => e.name === 'PCSX2')).toBe(true);
    expect(list.some((e) => e.name === 'xemu')).toBe(true);
  });

  it('returns emulator memory layout by name', () => {
    const layout = getEmulatorMemoryLayout('Dolphin');
    expect(layout).toBeDefined();
    expect(layout!.length).toBe(3);
    expect(layout![0]!.name).toBe('MEM1');
    expect(layout![0]!.typicalSize).toBe(0x01800000);
  });
});
