/**
 * Base Memory Manager - Abstract Base Class
 * Defines the interface for platform-specific implementations
 */

import type {
  MemoryReadResult,
  MemoryWriteResult,
  MemoryScanResult,
  MemoryProtectionInfo,
  ModuleInfo,
  PatternType,
} from '@modules/process/types';
import { buildPatternBytesAndMask } from '@modules/process/memory/scanner.patterns';

export abstract class BaseMemoryManager {
  abstract readonly platform: string;

  abstract readMemory(pid: number, address: number, size: number): Promise<MemoryReadResult>;

  abstract writeMemory(pid: number, address: number, data: Buffer): Promise<MemoryWriteResult>;

  abstract scanMemory(
    pid: number,
    pattern: string,
    patternType: PatternType,
    suspendTarget?: boolean,
  ): Promise<MemoryScanResult>;

  abstract checkMemoryProtection(pid: number, address: number): Promise<MemoryProtectionInfo>;

  abstract enumerateRegions(
    pid: number,
  ): Promise<{ success: boolean; regions?: ModuleInfo[]; error?: string }>;

  abstract enumerateModules(
    pid: number,
  ): Promise<{ success: boolean; modules?: ModuleInfo[]; error?: string }>;

  abstract dumpMemoryRegion(
    pid: number,
    address: number,
    size: number,
    outputPath: string,
  ): Promise<{ success: boolean; error?: string }>;

  abstract injectDll(
    pid: number,
    dllPath: string,
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }>;

  abstract injectShellcode(
    pid: number,
    shellcode: Buffer,
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }>;

  abstract checkDebugPort(
    pid: number,
  ): Promise<{ success: boolean; isDebugged?: boolean; error?: string }>;

  abstract checkAvailability(): Promise<{ available: boolean; reason?: string }>;

  protected convertPatternToBytes(
    pattern: string,
    patternType: PatternType,
  ): { bytes: number[]; mask: number[] } {
    // Delegate to the shared scanner pattern parser (lenient). Unlike the
    // scanner variants this legacy helper returns empty arrays instead of
    // throwing on an empty result.
    const { patternBytes, mask } = buildPatternBytesAndMask(pattern, patternType, {
      throwOnEmpty: false,
    });
    return { bytes: patternBytes, mask };
  }
}
