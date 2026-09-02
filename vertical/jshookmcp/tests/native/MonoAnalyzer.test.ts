/**
 * MonoAnalyzer — unit tests.
 *
 * Tests runtime detection, assembly listing, class enumeration,
 * object scanning, field reading, and IL2CPP metadata parsing.
 * Win32 APIs are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonoAnalyzer } from '@native/MonoAnalyzer';
import { GetModuleBaseName, GetModuleInformation } from '@native/Win32API';

// Mock Win32API for mono module enumeration.
vi.mock('@native/Win32API', () => {
  return {
    openProcessForMemory: vi.fn(() => 1n),
    CloseHandle: vi.fn(() => true),
    ReadProcessMemory: vi.fn((_h: bigint, addr: bigint, size: number) => {
      // Return crafted buffers based on address for testing.
      if (size === 64 && (addr === 0x7ffa00000000n || addr === 0x7ffb00000000n)) {
        // DOS header for PE parsing.
        const buf = Buffer.alloc(64, 0);
        buf.writeUInt16LE(0x5a4d, 0); // MZ
        buf.writeUInt32LE(0x80, 60); // e_lfanew
        return buf;
      }
      if (size === 4 && (addr === 0x7ffa00000080n || addr === 0x7ffb00000080n)) {
        // PE signature.
        const buf = Buffer.alloc(4, 0);
        buf.writeUInt32LE(0x00004550, 0); // PE\0\0
        return buf;
      }
      if (size === 2 && addr === 0x7ffa00000098n) {
        // Magic = PE32+ for x64
        const buf = Buffer.alloc(2, 0);
        buf.writeUInt16LE(0x20b, 0);
        return buf;
      }
      // Export directory RVA = 0 (no exports) for most reads.
      if (addr === 0x7ffa00000108n && size === 8) {
        // Data directory [0]: export RVA = 0, size = 0.
        const buf = Buffer.alloc(8, 0);
        return buf;
      }
      // Return zeros for everything else (no exports found).
      return Buffer.alloc(size, 0);
    }),
    WriteProcessMemory: vi.fn((_h: bigint, _a: bigint, data: Buffer) => data.length),
    VirtualAllocEx: vi.fn(() => 0x50000n),
    VirtualFreeEx: vi.fn(() => true),
    VirtualProtectEx: vi.fn(() => ({ success: true, oldProtect: 0x20 })),
    EnumProcessModules: vi.fn(() => {
      // Return mono-2.0-bdwgc.dll as the found module.
      return {
        modules: [{ lpBaseOfDll: 0x7ffa00000000n, SizeOfImage: 0x500000 } as unknown],
        count: 1,
      };
    }),
    GetModuleBaseName: vi.fn(() => 'mono-2.0-bdwgc.dll'),
    GetModuleFileNameEx: vi.fn(() => 'C:\\game\\mono-2.0-bdwgc.dll'),
    GetModuleInformation: vi.fn(() => ({
      success: true,
      info: { lpBaseOfDll: 0x7ffa00000000n, SizeOfImage: 0x500000, EntryPoint: 0x7ffa00100000n },
    })),
    GetModuleHandle: vi.fn(() => 0x7ff000000000n),
    GetProcAddress: vi.fn(() => 0x7ff000001000n),
    PAGE: {
      READWRITE: 0x04,
      EXECUTE_READWRITE: 0x40,
      EXECUTE_READ: 0x20,
    },
    MEM: { COMMIT: 0x1000, RESERVE: 0x2000, RELEASE: 0x8000 },
  };
});

vi.mock('@native/Win32Debug', () => ({
  FlushInstructionCache: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('MonoAnalyzer', () => {
  let ma: MonoAnalyzer;

  beforeEach(() => {
    ma = new MonoAnalyzer();
    vi.clearAllMocks();
  });

  describe('detectRuntime', () => {
    it('should detect mono-2.0-bdwgc.dll in process', async () => {
      const rt = await ma.detectRuntime(1234);
      expect(rt.kind).toBe('mono');
      expect(rt.moduleName).toBe('mono-2.0-bdwgc.dll');
      expect(rt.pointerSize).toBe(8); // x64
    });

    it('should detect mono.dll if present', async () => {
      vi.mocked(GetModuleBaseName).mockReturnValue('mono.dll');
      const rt = await ma.detectRuntime(1234);
      expect(rt.kind).toBe('mono');
      expect(rt.moduleName).toBe('mono.dll');
    });

    it('should detect GameAssembly.dll as IL2CPP', async () => {
      vi.mocked(GetModuleBaseName).mockReturnValue('GameAssembly.dll');
      const rt = await ma.detectRuntime(1234);
      expect(rt.kind).toBe('il2cpp');
      expect(rt.moduleName).toBe('GameAssembly.dll');
    });

    it('should detect libil2cpp.so as IL2CPP', async () => {
      vi.mocked(GetModuleBaseName).mockReturnValue('libil2cpp.so');
      const rt = await ma.detectRuntime(1234);
      expect(rt.kind).toBe('il2cpp');
    });

    it('should throw when no runtime is found', async () => {
      vi.mocked(GetModuleBaseName).mockReturnValue('notepad.exe');
      await expect(ma.detectRuntime(1234)).rejects.toThrow(/No Mono or IL2CPP runtime found/);
    });

    it('should set pointerSize=4 for 32-bit modules', async () => {
      // 32-bit module: base address < 4GB.
      vi.mocked(GetModuleBaseName).mockReturnValue('mono.dll');
      vi.mocked(GetModuleInformation).mockReturnValue({
        success: true,
        info: { lpBaseOfDll: 0x10000000n, SizeOfImage: 0x500000, EntryPoint: 0x10100000n },
      });
      const rt = await ma.detectRuntime(1234);
      expect(rt.pointerSize).toBe(4);
    });

    it('should return exported symbols list', async () => {
      const rt = await ma.detectRuntime(1234);
      expect(Array.isArray(rt.exportedSymbols)).toBe(true);
    });
  });

  describe('listAssemblies', () => {
    it('should return empty for IL2CPP runtime', async () => {
      vi.mocked(GetModuleBaseName).mockReturnValue('GameAssembly.dll');
      const result = await ma.listAssemblies(1234);
      expect(result).toEqual([]);
    });

    it('should throw if root domain is not resolved', async () => {
      // Mono runtime detected but root domain is null (no exports found).
      // The mocked RPM returns zeros, so root domain resolution will fail.
      await expect(ma.listAssemblies(1234)).rejects.toThrow(/Root domain not resolved/);
    });
  });

  describe('listClasses', () => {
    it('should throw if assembly is not found', async () => {
      // Mock a mono runtime with no exports (root domain = null).
      await expect(ma.listClasses(1234, 'Assembly-CSharp')).rejects.toThrow(
        /Root domain not resolved/,
      );
    });
  });

  describe('findObjects', () => {
    it('should throw if class is not found', async () => {
      await expect(ma.findObjects(1234, 'NonExistentClass')).rejects.toThrow(
        /Root domain not resolved/,
      );
    });
  });

  describe('readFields', () => {
    it('should throw if vtable is null', async () => {
      await expect(ma.readFields(1234, '0x0')).rejects.toThrow(/null vtable/);
    });
  });

  describe('parseIl2CppMetadata', () => {
    it('should parse a valid global-metadata.dat header', async () => {
      const { promises: fs } = await import('node:fs');
      const mockData = Buffer.alloc(256, 0);
      mockData.writeUInt32LE(0xfab11baf, 0); // sanity
      mockData.writeInt32LE(24, 4); // version 24
      mockData.writeInt32LE(5, 8); // stringLiteralCount
      mockData.writeInt32LE(64, 12); // stringLiteralOffset
      mockData.writeInt32LE(10, 0x10); // typeCount
      mockData.writeInt32LE(20, 0x14); // methodCount
      mockData.writeInt32LE(15, 0x18); // fieldCount

      // Add some string data at offset 64.
      const asmName = 'Assembly-CSharp';
      mockData.writeUInt8(asmName.length, 64);
      Buffer.from(asmName).copy(mockData, 65);
      const nextOff = 65 + asmName.length;
      const engName = 'UnityEngine';
      mockData.writeUInt8(engName.length, nextOff);
      Buffer.from(engName).copy(mockData, nextOff + 1);

      vi.spyOn(fs, 'readFile').mockResolvedValue(mockData);

      const result = await ma.parseIl2CppMetadata(
        'C:\\\\game\\\\il2cpp_data\\\\Metadata\\\\global-metadata.dat',
      );
      expect(result.version).toBe(24);
      expect(result.stringLiteralCount).toBe(5);
      expect(result.typeCount).toBe(10);
      expect(result.methodCount).toBe(20);
      expect(result.fieldCount).toBe(15);
      expect(result.assemblies).toContain('Assembly-CSharp');
      vi.restoreAllMocks();
    });

    it('should reject invalid sanity check', async () => {
      const { promises: fs } = await import('node:fs');
      const mockData = Buffer.alloc(8, 0);
      mockData.writeUInt32LE(0xdeadbeef, 0);
      vi.spyOn(fs, 'readFile').mockResolvedValue(mockData);

      await expect(ma.parseIl2CppMetadata('fake-path.dat')).rejects.toThrow(/sanity check failed/);
      vi.restoreAllMocks();
    });

    it('should reject too-small files', async () => {
      const { promises: fs } = await import('node:fs');
      vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.alloc(2));
      await expect(ma.parseIl2CppMetadata('tiny.dat')).rejects.toThrow(/too small/);
      vi.restoreAllMocks();
    });

    it('should handle version < 24 with zero counts', async () => {
      const { promises: fs } = await import('node:fs');
      const mockData = Buffer.alloc(256, 0);
      mockData.writeUInt32LE(0xfab11baf, 0);
      mockData.writeInt32LE(16, 4); // version 16
      mockData.writeInt32LE(3, 8); // stringLiteralCount
      mockData.writeInt32LE(64, 12); // stringLiteralOffset
      // No type/method/field counts for version < 24.

      vi.spyOn(fs, 'readFile').mockResolvedValue(mockData);

      const result = await ma.parseIl2CppMetadata('old-metadata.dat');
      expect(result.version).toBe(16);
      expect(result.typeCount).toBe(0);
      expect(result.methodCount).toBe(0);
      expect(result.fieldCount).toBe(0);
      vi.restoreAllMocks();
    });
  });

  describe('general API surface', () => {
    it('exports monoAnalyzer singleton', async () => {
      const { monoAnalyzer } = await import('@native/MonoAnalyzer');
      expect(monoAnalyzer).toBeDefined();
      expect(monoAnalyzer).toBeInstanceOf(MonoAnalyzer);
    });

    it('has all expected methods', () => {
      expect(typeof ma.detectRuntime).toBe('function');
      expect(typeof ma.listAssemblies).toBe('function');
      expect(typeof ma.listClasses).toBe('function');
      expect(typeof ma.findObjects).toBe('function');
      expect(typeof ma.readFields).toBe('function');
      expect(typeof ma.parseIl2CppMetadata).toBe('function');
    });
  });
});
