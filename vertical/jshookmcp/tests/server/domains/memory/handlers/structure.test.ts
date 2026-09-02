import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StructureHandlers } from '../../../../../src/server/domains/memory/handlers/structure';

const factoryState = vi.hoisted(() => ({
  openProcess: vi.fn(),
  readMemory: vi.fn(),
  closeProcess: vi.fn(),
}));

// Lock the group-comparison read path onto a fake provider so the
// b3-09/a4-01 createPlatformProvider() migration is exercised (not the real
// Win32/Darwin/Linux FFI provider). Mirrors tests/modules/process/memory/reader.test.ts:35.
vi.mock('@native/platform/factory.js', () => ({
  createPlatformProvider: vi.fn(() => ({
    openProcess: factoryState.openProcess,
    readMemory: factoryState.readMemory,
    closeProcess: factoryState.closeProcess,
  })),
}));

describe('StructureHandlers', () => {
  let handlers: StructureHandlers;
  const dummyArgs = {
    pid: 1234,
    address: '0x7FF612340000',
    address1: '0x7FF612340000',
    address2: '0x7FF612341000',
    vtableAddress: '0x7FF612342000',
    structure: JSON.stringify({ fields: [], baseAddress: '0x0', totalSize: 0 }),
    name: 'TestStruct',
    size: 256,
    parseRtti: true,
    otherInstances: ['0x7FF612341000'],
  };

  const mockstructAnalyzer = {/* mock */} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockstructAnalyzer).forEach((key) => delete mockstructAnalyzer[key]);
    handlers = new StructureHandlers(mockstructAnalyzer);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(StructureHandlers);
  });

  describe('handleStructureAnalyze', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn().mockReturnValue({
        className: 'Foo',
        fields: [],
        baseClasses: [],
      });

      const response = await handlers.handleStructureAnalyze(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hint).toContain('Foo');
      expect(mockstructAnalyzer.analyzeStructure).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        expect.objectContaining({ size: 256, parseRtti: true, otherInstances: ['0x7FF612341000'] }),
      );
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleStructureAnalyze(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects invalid address', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn();
      const response = await handlers.handleStructureAnalyze({ pid: 1234, address: 'xyz' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/address base|cannot parse/);
      expect(mockstructAnalyzer.analyzeStructure).not.toHaveBeenCalled();
    });

    it('rejects non-positive size', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn();
      const response = await handlers.handleStructureAnalyze({
        pid: 1234,
        address: '0x1',
        size: -5,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"size" must be a positive number');
      expect(mockstructAnalyzer.analyzeStructure).not.toHaveBeenCalled();
    });
  });

  describe('handleVtableParse', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.parseVtable = vi.fn().mockReturnValue({ entries: [] });

      const response = await handlers.handleVtableParse(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockstructAnalyzer.parseVtable).toHaveBeenCalledWith(1234, '0x7FF612342000');
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.parseVtable = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleVtableParse(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing vtableAddress', async () => {
      mockstructAnalyzer.parseVtable = vi.fn();
      const response = await handlers.handleVtableParse({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/vtableAddress|invalid required/);
      expect(mockstructAnalyzer.parseVtable).not.toHaveBeenCalled();
    });
  });

  describe('handleStructureExportC', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn().mockReturnValue({
        name: 'TestStruct',
        definition: 'struct TestStruct {};',
        size: 0,
        fieldCount: 0,
      });

      const response = await handlers.handleStructureExportC(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockstructAnalyzer.exportToCStruct).toHaveBeenCalledWith(
        expect.objectContaining({ totalSize: 0, fields: [] }),
        'TestStruct',
      );
    });

    it('normalizes legacy export payloads before delegating to the analyzer', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn().mockReturnValue({
        name: 'RuntimeAuditStruct',
        definition: 'struct RuntimeAuditStruct {};',
        size: 8,
        fieldCount: 1,
      });

      const response = await handlers.handleStructureExportC({
        structure: JSON.stringify({
          name: 'RuntimeAuditStruct',
          size: 8,
          fields: [{ name: 'flag', offset: 0, size: 4, type: 'uint32_t' }],
        }),
        name: 'RuntimeAuditStruct',
      });

      expect(mockstructAnalyzer.exportToCStruct).toHaveBeenCalledWith(
        expect.objectContaining({
          totalSize: 8,
          fields: [
            expect.objectContaining({
              name: 'flag',
              offset: 0,
              size: 4,
              type: 'uint32',
            }),
          ],
        }),
        'RuntimeAuditStruct',
      );
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleStructureExportC(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing structure argument', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn();
      const response = await handlers.handleStructureExportC({});
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_structure_export_c');
      expect(parsed.error).toContain('"structure"');
      expect(mockstructAnalyzer.exportToCStruct).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON structure', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn();
      const response = await handlers.handleStructureExportC({ structure: '{not json' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('must be valid JSON');
      expect(mockstructAnalyzer.exportToCStruct).not.toHaveBeenCalled();
    });
  });

  describe('handleStructureCompare', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.compareInstances = vi.fn().mockReturnValue({
        matching: [{ name: 'a' }],
        differing: [{ name: 'b' }],
      });

      const response = await handlers.handleStructureCompare(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.matchingFieldCount).toBe(1);
      expect(parsed.differingFieldCount).toBe(1);
      expect(mockstructAnalyzer.compareInstances).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        '0x7FF612341000',
        256,
      );
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.compareInstances = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleStructureCompare(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing address2', async () => {
      mockstructAnalyzer.compareInstances = vi.fn();
      const response = await handlers.handleStructureCompare({
        pid: 1234,
        address1: '0x1',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/address2|invalid required/);
      expect(mockstructAnalyzer.compareInstances).not.toHaveBeenCalled();
    });
  });

  describe('handleStructureCompare — group mode (provider migration lock)', () => {
    it('reads group instances via createPlatformProvider and releases the handle', async () => {
      const handle = { pid: 1234, writeAccess: false };
      factoryState.openProcess.mockReturnValue(handle);
      factoryState.readMemory.mockImplementation(async (_handle, _addr, size) => ({
        data: Buffer.alloc(size, 0x41),
        bytesRead: size,
      }));
      mockstructAnalyzer.compareInstances = vi.fn();

      const response = await handlers.handleStructureCompare({
        pid: 1234,
        address1: '0x7FF612340000',
        address2: '0x7FF612341000',
        group1Addresses: ['0x7FF612340000', '0x7FF612340010'],
        group2Addresses: ['0x7FF612341000'],
      });
      const parsed = JSON.parse((response.content[0] as any).text);

      expect(parsed.success).toBe(true);
      expect(parsed.totalInstances).toBe(3);
      expect(parsed.group1Count).toBe(2);
      expect(parsed.group2Count).toBe(1);
      // Lock: the group read path must route through the platform provider
      // (b3-09/a4-01 async migration), not structAnalyzer.compareInstances.
      expect(factoryState.openProcess).toHaveBeenCalledWith(1234, false);
      expect(factoryState.readMemory).toHaveBeenCalledTimes(3);
      expect(factoryState.closeProcess).toHaveBeenCalledWith(handle);
      expect(mockstructAnalyzer.compareInstances).not.toHaveBeenCalled();
    });
  });

  describe('handleStructureExportC — ReClass.NET format', () => {
    it('exports ReClass XML for a simple structure', async () => {
      // No mock for exportReClassXml — it's a handler-level pure function.
      const response = await handlers.handleStructureExportC({
        structure: JSON.stringify({
          baseAddress: '0x0',
          totalSize: 16,
          fields: [
            { name: 'vtable', offset: 0, size: 8, type: 'vtable_ptr', confidence: 1 },
            { name: 'health', offset: 8, size: 4, type: 'int32', confidence: 0.9 },
            { name: 'speed', offset: 12, size: 4, type: 'float', confidence: 0.8 },
          ],
        }),
        name: 'Player',
        format: 'reclass',
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.format).toBe('reclass');
      expect(parsed.xml).toContain('<ReClassProject Version="1.0">');
      expect(parsed.xml).toContain('<Class Name="Player"');
      expect(parsed.xml).toContain('Type="vt_ptr"');
      expect(parsed.xml).toContain('Type="int32"');
      expect(parsed.xml).toContain('Type="float"');
      expect(parsed.fieldCount).toBe(3);
    });

    it('maps field types to ReClass types correctly', async () => {
      const response = await handlers.handleStructureExportC({
        structure: JSON.stringify({
          baseAddress: '0x0',
          totalSize: 48,
          fields: [
            { name: 'ptr', offset: 0, size: 8, type: 'pointer', confidence: 1 },
            { name: 'str', offset: 8, size: 8, type: 'string_ptr', confidence: 1 },
            { name: 'hex', offset: 16, size: 4, type: 'hex', confidence: 0.5 },
            { name: 'pad', offset: 20, size: 4, type: 'padding', confidence: 0.5 },
            { name: 'dbl', offset: 24, size: 8, type: 'double', confidence: 1 },
            { name: 'large', offset: 32, size: 8, type: 'int64', confidence: 1 },
            { name: 'flag', offset: 40, size: 1, type: 'uint8', confidence: 1 },
            { name: 'unk', offset: 41, size: 7, type: 'unknown', confidence: 0.2 },
          ],
        }),
        name: 'TypeMap',
        format: 'reclass',
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.fieldCount).toBe(8);
      // Verify type mappings
      expect(parsed.xml).toContain('Type="ptr64"'); // pointer → ptr64
      expect(parsed.xml).toContain('Type="ptr64"'); // string_ptr → ptr64
      expect(parsed.xml).toContain('Type="hex32"'); // hex → hex32, unknown → hex32
      expect(parsed.xml).toContain('Type="Bytes"'); // padding → Bytes
      expect(parsed.xml).toContain('Type="double"'); // double → double
      expect(parsed.xml).toContain('Type="int64"'); // int64 → int64
      expect(parsed.xml).toContain('Type="uint8"'); // uint8 → uint8
    });

    it('defaults format to C when not specified', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn().mockReturnValue({
        name: 'TestStruct',
        definition: 'struct TestStruct {};',
        size: 0,
        fieldCount: 0,
      });

      const response = await handlers.handleStructureExportC({
        structure: JSON.stringify({ fields: [], baseAddress: '0x0', totalSize: 0 }),
        name: 'TestStruct',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.format).toBe('c');
    });
  });
});
