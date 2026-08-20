/**
 * RTTI Parser — Windows/MSVC-specific RTTI structure parsing.
 *
 * Parses RTTI Complete Object Locator (COL) structures from vtables to extract
 * class names and inheritance hierarchies on MSVC x64 binaries.
 *
 * @module StructureAnalyzer.RttiParser
 */

import { STRUCT_RTTI_MAX_STRING_LEN } from '@src/constants';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import type { ProcessHandle } from './platform/types.js';

export class RttiParser {
  constructor(
    private provider: PlatformMemoryAPI,
    private readCString: (handle: ProcessHandle, address: bigint, maxLen: number) => string | null,
    private isValidReadablePointer: (handle: ProcessHandle, address: bigint) => boolean,
  ) {}

  /**
   * Parse RTTI Complete Object Locator (MSVC x64 layout).
   *
   * vtable[-1] → RTTI COL:
   *   +0x00: signature (1 for x64)
   *   +0x04: offset
   *   +0x08: cdOffset
   *   +0x0C: typeDescriptorRVA
   *   +0x10: classDescriptorRVA
   *   +0x14: objectLocatorRVA
   *
   * TypeDescriptor (at moduleBase + typeDescriptorRVA):
   *   +0x00: pVFTable (pointer)
   *   +0x08: spare (pointer)
   *   +0x10: name (null-terminated mangled string)
   */
  async parseRtti(
    vtableAddress: bigint,
    handle: ProcessHandle,
  ): Promise<{ className: string; baseClasses: string[] } | null> {
    try {
      // Read vtable[-1]: pointer to COL
      const colPtrBuf = this.provider.readMemory(handle, vtableAddress - 8n, 8).data;
      const colAddr = colPtrBuf.readBigUInt64LE(0);

      // Validate COL pointer
      if (!this.isValidReadablePointer(handle, colAddr)) return null;

      const col = this.readCompleteObjectLocator(handle, colAddr);
      if (!col) return null;

      // Calculate module base from objectLocatorRVA:
      // moduleBase = colAddr - objectLocatorRVA
      const moduleBase = colAddr - BigInt(col.objectLocRVA);

      // Read TypeDescriptor
      const typeDescAddr = moduleBase + BigInt(col.typeDescRVA);
      const className = this.readTypeDescriptor(handle, typeDescAddr);
      if (!className) return null;

      // Try to read class hierarchy
      const baseClasses = await this.readClassDescriptor(handle, moduleBase, col.classDescRVA);

      return { className, baseClasses };
    } catch {
      return null;
    }
  }

  private readCompleteObjectLocator(
    handle: ProcessHandle,
    colAddr: bigint,
  ): {
    signature: number;
    typeDescRVA: number;
    classDescRVA: number;
    objectLocRVA: number;
  } | null {
    try {
      const colBuf = this.provider.readMemory(handle, colAddr, 0x18).data;
      const signature = colBuf.readUInt32LE(0);

      // Signature must be 1 for x64
      if (signature !== 1) return null;

      return {
        signature,
        typeDescRVA: colBuf.readUInt32LE(0x0c),
        classDescRVA: colBuf.readUInt32LE(0x10),
        objectLocRVA: colBuf.readUInt32LE(0x14),
      };
    } catch {
      return null;
    }
  }

  private readTypeDescriptor(handle: ProcessHandle, typeDescAddr: bigint): string | null {
    const className = this.readCString(handle, typeDescAddr + 0x10n, STRUCT_RTTI_MAX_STRING_LEN);
    if (!className) return null;

    // Demangle basic MSVC names: ".?AVClassName@@" → "ClassName"
    return this.demangleMsvcName(className);
  }

  private async readClassDescriptor(
    handle: ProcessHandle,
    moduleBase: bigint,
    classDescRVA: number,
  ): Promise<string[]> {
    const baseClasses: string[] = [];
    try {
      const classDescAddr = moduleBase + BigInt(classDescRVA);
      const classDescBuf = this.provider.readMemory(handle, classDescAddr, 0x10).data;
      const numBaseClasses = classDescBuf.readUInt32LE(0x08);
      const baseClassArrayRVA = classDescBuf.readUInt32LE(0x0c);

      if (numBaseClasses > 0 && numBaseClasses < 20) {
        const baseArrayAddr = moduleBase + BigInt(baseClassArrayRVA);
        const baseArrayBuf = this.provider.readMemory(
          handle,
          baseArrayAddr,
          numBaseClasses * 4,
        ).data;

        for (let i = 1; i < numBaseClasses; i++) {
          // Skip index 0 (self)
          const baseDescRVA = baseArrayBuf.readUInt32LE(i * 4);
          const baseDescAddr = moduleBase + BigInt(baseDescRVA);

          try {
            const baseDescBuf = this.provider.readMemory(handle, baseDescAddr, 0x08).data;
            const baseTypeDescRVA = baseDescBuf.readUInt32LE(0);
            const baseTypeDescAddr = moduleBase + BigInt(baseTypeDescRVA);
            const baseName = this.readCString(
              handle,
              baseTypeDescAddr + 0x10n,
              STRUCT_RTTI_MAX_STRING_LEN,
            );
            if (baseName) {
              baseClasses.push(this.demangleMsvcName(baseName));
            }
          } catch {
            break;
          }
        }
      }
    } catch {
      // Best-effort
    }
    return baseClasses;
  }

  private demangleMsvcName(name: string): string {
    // ".?AVClassName@@" → "ClassName"
    // ".?AUStructName@@" → "StructName"
    const match = name.match(/\.?\?A[VU](.+?)@@/);
    if (match) return match[1]!;

    // ".?AW4EnumName@@" → "EnumName" (enums)
    const enumMatch = name.match(/\.?\?AW4(.+?)@@/);
    if (enumMatch) return enumMatch[1]!;

    // Remove leading "." and trailing "@@"
    return name.replace(/^\./, '').replace(/@@$/, '');
  }
}
