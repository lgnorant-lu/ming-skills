/**
 * Inline Assembler — x64dbg parity for editing instructions.
 *
 * Assembles x64 assembly instructions into machine code bytes.
 * Primary path: Keystone assembler via koffi FFI (keystone.dll on Windows).
 * Fallback: built-in opcode table for common instructions when Keystone
 * is unavailable (e.g. non-Windows, missing DLL).
 *
 * Actions:
 * - assemble: take ASM string, produce machine code bytes
 * - assemble_at: assemble + write to target process at address (destructive)
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argBool } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { validateHexAddress, requireStringArg } from './validation';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';

const TOOL_NAME = 'memory_assemble';

/** Maximum number of instructions to assemble in one call. */
const MAX_INSTRUCTIONS = 256;

/** Maximum assembled byte length. */
const MAX_ASSEMBLED_BYTES = 4096;

// ── Keystone FFI binding ──

interface KeystoneEngine {
  ks_open(arch: number, mode: number): number;
  ks_asm(
    ks: number,
    code: string,
    address: number,
  ): { encoding: Uint8Array; count: number; size: number };
  ks_close(ks: number): void;
  ks_errno(ks: number): number;
  ks_strerror(code: number): string;
  ks_free(buf: unknown): void;
}

let keystoneInstance: KeystoneEngine | null = null;
let keystoneLoadAttempted = false;

async function tryLoadKeystone(): Promise<KeystoneEngine | null> {
  if (keystoneLoadAttempted) return keystoneInstance;
  keystoneLoadAttempted = true;

  try {
    // koffi is a CJS native addon; dynamic import() returns
    // { default: module.exports } for CJS modules in ESM context. Intentional
    // exception to koffi-loader's single-load-point rule: this probes a
    // *specific* keystone.dll binding on demand (try/catch-guarded) and hits
    // the ESM module cache, so the binding is not re-executed.
    const koffiModule = await import('koffi');
    const koffi = ((koffiModule as { default?: unknown }).default ?? koffiModule) as {
      load: (lib: string) => Record<string, unknown>;
    };
    const lib = koffi.load('keystone.dll');

    // KS_ARCH_X86 = 3, KS_MODE_64 = 4
    const ks_open = lib.ks_open as (arch: number, mode: number) => number;
    const ks_asm = lib.ks_asm as (
      ks: number,
      code: string,
      address: number,
    ) => { encoding: Uint8Array; count: number; size: number };
    const ks_close = lib.ks_close as (ks: number) => void;
    const ks_errno = lib.ks_errno as (ks: number) => number;
    const ks_strerror = lib.ks_strerror as (code: number) => string;
    const ks_free = lib.ks_free as (buf: unknown) => void;

    keystoneInstance = { ks_open, ks_asm, ks_close, ks_errno, ks_strerror, ks_free };
    logger.info('Keystone assembler loaded via koffi (keystone.dll)');
  } catch (err) {
    logger.debug(
      'Keystone not available — using fallback opcode table:',
      err instanceof Error ? err.message : String(err),
    );
    keystoneInstance = null;
  }

  return keystoneInstance;
}

// ── Fallback opcode table for common x64 instructions ──
//
// This covers the most common instructions used in memory patching.
// Each entry maps a normalized instruction string to its byte encoding.
// The fallback is intentionally limited — for full assembly, install Keystone.

interface FallbackEntry {
  /** Normalized lowercase mnemonic + operands pattern (regex). */
  pattern: RegExp;
  /** Function to produce bytes from regex match groups. */
  encode: (match: RegExpMatchArray) => number[];
}

const FALLBACK_TABLE: FallbackEntry[] = [
  // NOP (0x90)
  { pattern: /^nop$/i, encode: () => [0x90] },

  // RET (0xC3)
  { pattern: /^ret$/i, encode: () => [0xc3] },

  // RET imm16 (0xC2)
  {
    pattern: /^ret\s+(0x[0-9a-fA-F]+|\d+)$/i,
    encode: (m) => {
      const imm = parseInt(m[1]!, 0);
      return [0xc2, imm & 0xff, (imm >> 8) & 0xff];
    },
  },

  // INT3 (0xCC)
  { pattern: /^int3$/i, encode: () => [0xcc] },

  // PUSH reg64 (0x50 + reg)
  {
    pattern: /^push\s+(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)$/i,
    encode: (m) => {
      const reg = m[1]!;
      return [0x50 + regIndex64(reg)];
    },
  },

  // POP reg64 (0x58 + reg)
  {
    pattern: /^pop\s+(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)$/i,
    encode: (m) => {
      const reg = m[1]!;
      return [0x58 + regIndex64(reg)];
    },
  },

  // MOV reg64, imm64 (REX.W + B8+reg)
  {
    pattern:
      /^mov\s+(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)\s*,\s*(0x[0-9a-fA-F]+|\d+)$/i,
    encode: (m) => {
      const reg = m[1]!;
      const imm = BigInt(parseInt(m[2]!, 0));
      const regIdx = regIndex64(reg);
      const rexW = regIdx >= 8 ? 0x41 : 0x48;
      const opcode = 0xb8 + (regIdx % 8);
      const bytes: number[] = [rexW, opcode];
      writeInt64LE(bytes, imm);
      return bytes;
    },
  },

  // MOV reg64, reg64 (REX.W + 89 /r) — e.g. "mov rax, rbx"
  {
    pattern:
      /^mov\s+(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)\s*,\s*(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)$/i,
    encode: (m) => {
      const dst = m[1]!;
      const src = m[2]!;
      const dstIdx = regIndex64(dst);
      const srcIdx = regIndex64(src);
      const rexW = dstIdx >= 8 || srcIdx >= 8 ? 0x4d : 0x48;
      if (dstIdx >= 8 && srcIdx >= 8) {
        return [0x4d, 0x89, 0xc0 + ((srcIdx % 8) << 3) + (dstIdx % 8)];
      }
      if (srcIdx >= 8) {
        return [0x4c, 0x89, 0xc0 + ((srcIdx % 8) << 3) + (dstIdx % 8)];
      }
      if (dstIdx >= 8) {
        return [0x4c, 0x89, 0xc0 + ((srcIdx % 8) << 3) + (dstIdx % 8)];
      }
      return [rexW, 0x89, 0xc0 + ((srcIdx % 8) << 3) + (dstIdx % 8)];
    },
  },

  // XOR reg64, reg64 (REX.W + 31 /r)
  {
    pattern:
      /^xor\s+(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)\s*,\s*(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)$/i,
    encode: (m) => {
      const dst = m[1]!;
      const src = m[2]!;
      const dstIdx = regIndex64(dst);
      const srcIdx = regIndex64(src);
      return modrmRexW(0x31, dstIdx, srcIdx);
    },
  },

  // ADD reg64, reg64 (REX.W + 01 /r)
  {
    pattern:
      /^add\s+(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)\s*,\s*(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)$/i,
    encode: (m) => {
      const dst = m[1]!;
      const src = m[2]!;
      return modrmRexW(0x01, regIndex64(dst), regIndex64(src));
    },
  },

  // SUB reg64, reg64 (REX.W + 29 /r)
  {
    pattern:
      /^sub\s+(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)\s*,\s*(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)$/i,
    encode: (m) => {
      const dst = m[1]!;
      const src = m[2]!;
      return modrmRexW(0x29, regIndex64(dst), regIndex64(src));
    },
  },

  // INC reg64 (REX.W + FF /0)
  {
    pattern: /^inc\s+(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)$/i,
    encode: (m) => {
      const reg = m[1]!;
      const idx = regIndex64(reg);
      return modrmRexW(0xff, idx, 0);
    },
  },

  // DEC reg64 (REX.W + FF /1)
  {
    pattern: /^dec\s+(rax|rcx|rdx|rbx|rsp|rbp|rsi|rdi|r8|r9|r10|r11|r12|r13|r14|r15)$/i,
    encode: (m) => {
      const reg = m[1]!;
      const idx = regIndex64(reg);
      return modrmRexW(0xff, idx, 1);
    },
  },

  // JMP rel8 (EB)
  {
    pattern: /^jmp\s+(0x[0-9a-fA-F]+|\d+)$/i,
    encode: () => {
      // Without address context, emit short JMP placeholder (EB FE = infinite loop)
      return [0xeb, 0xfe];
    },
  },

  // INT3 padding pattern (common multi-byte alignment)
  { pattern: /^int3\s*;\s*int3\s*;\s*int3$/i, encode: () => [0xcc, 0xcc, 0xcc] },
];

/** Map register name to x64 register index (0-15). */
function regIndex64(name: string): number {
  const lower = name.toLowerCase();
  const map: Record<string, number> = {
    rax: 0,
    rcx: 1,
    rdx: 2,
    rbx: 3,
    rsp: 4,
    rbp: 5,
    rsi: 6,
    rdi: 7,
    r8: 8,
    r9: 9,
    r10: 10,
    r11: 11,
    r12: 12,
    r13: 13,
    r14: 14,
    r15: 15,
  };
  const idx = map[lower];
  if (idx === undefined) {
    throw new Error(`${TOOL_NAME}: unknown register "${name}"`);
  }
  return idx;
}

/** Build REX.W ModR/M encoding for simple reg-reg operations. */
function modrmRexW(opcode: number, reg: number, rm: number): number[] {
  const needRex = reg >= 8 || rm >= 8;
  if (!needRex) {
    return [0x48, opcode, 0xc0 + (reg << 3) + rm];
  }
  // REX.W + REX.B(or REX.R) prefix
  let rex = 0x48; // REX.W
  if (reg >= 8) rex |= 0x04; // REX.R
  if (rm >= 8) rex |= 0x01; // REX.B
  return [rex, opcode, 0xc0 + ((reg % 8) << 3) + (rm % 8)];
}

/** Write a 64-bit little-endian value into a byte array (mutates array). */
function writeInt64LE(bytes: number[], value: bigint): void {
  for (let i = 0; i < 8; i += 1) {
    bytes.push(Number((value >> BigInt(i * 8)) & BigInt(0xff)));
  }
}

// ── Assembly engine ──

export interface AssembleResult {
  /** Hex byte string (e.g. "48 C7 C0 34 12 00 00 90 C3") */
  hex: string;
  /** Decoded bytes as array */
  bytes: number[];
  /** Number of instructions assembled */
  instructionCount: number;
  /** Total byte length */
  byteLength: number;
  /** Engine used: "keystone" or "fallback" */
  engine: 'keystone' | 'fallback';
  /** Warnings about unsupported instructions (fallback only) */
  warnings?: string[];
}

export async function assembleAsm(code: string, address?: number): Promise<AssembleResult> {
  // Split instructions by semicolon or newline
  const instructions = code
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (instructions.length === 0) {
    throw new Error(`${TOOL_NAME}: no instructions provided in assembly string`);
  }

  if (instructions.length > MAX_INSTRUCTIONS) {
    throw new Error(
      `${TOOL_NAME}: too many instructions (${instructions.length}), max is ${MAX_INSTRUCTIONS}`,
    );
  }

  // Try Keystone first
  const ks = await tryLoadKeystone();
  if (ks) {
    return assembleWithKeystone(ks, instructions, address ?? 0);
  }

  // Fallback: built-in opcode table
  return assembleWithFallback(instructions);
}

function assembleWithKeystone(
  ks: KeystoneEngine,
  instructions: string[],
  baseAddr: number,
): AssembleResult {
  const KS_ARCH_X86 = 3;
  const KS_MODE_64 = 4;

  const handle = ks.ks_open(KS_ARCH_X86, KS_MODE_64);
  if (handle === 0) {
    const errCode = ks.ks_errno(0);
    throw new Error(`${TOOL_NAME}: ks_open failed: ${ks.ks_strerror(errCode)} (code ${errCode})`);
  }

  try {
    const allBytes: number[] = [];
    for (let i = 0; i < instructions.length; i += 1) {
      const instrAddr = baseAddr + allBytes.length;
      const code = instructions[i]!;
      try {
        const result = ks.ks_asm(handle, code, instrAddr);
        if (!result || !result.encoding || result.encoding.length === 0) {
          const errCode = ks.ks_errno(handle);
          throw new Error(
            `Failed to assemble instruction ${i + 1} "${code}": ${ks.ks_strerror(errCode)}`,
          );
        }
        for (let j = 0; j < result.encoding.length; j += 1) {
          allBytes.push(result.encoding[j]!);
        }
      } catch (e) {
        throw new Error(
          `${TOOL_NAME}: failed to assemble instruction ${i + 1} "${code}": ${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        );
      }
    }

    if (allBytes.length === 0) {
      throw new Error(`${TOOL_NAME}: assembly produced 0 bytes`);
    }

    if (allBytes.length > MAX_ASSEMBLED_BYTES) {
      throw new Error(
        `${TOOL_NAME}: assembled code is ${allBytes.length} bytes, max is ${MAX_ASSEMBLED_BYTES}`,
      );
    }

    return {
      hex: allBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
      bytes: allBytes,
      instructionCount: instructions.length,
      byteLength: allBytes.length,
      engine: 'keystone',
    };
  } finally {
    ks.ks_close(handle);
  }
}

function assembleWithFallback(instructions: string[]): AssembleResult {
  const allBytes: number[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < instructions.length; i += 1) {
    const instr = instructions[i]!;
    let matched = false;

    for (const entry of FALLBACK_TABLE) {
      const match = entry.pattern.exec(instr);
      if (match) {
        const bytes = entry.encode(match);
        for (const b of bytes) {
          allBytes.push(b);
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      warnings.push(
        `Instruction ${i + 1} "${instr}" is not in the fallback opcode table. ` +
          `Only common instructions are supported without Keystone. ` +
          `Install keystone.dll for full x64 assembly support.`,
      );
      // Emit a placeholder INT3 so downstream consumers can see the gap
      allBytes.push(0xcc);
    }
  }

  if (allBytes.length === 0) {
    throw new Error(`${TOOL_NAME}: no instructions could be assembled`);
  }

  if (allBytes.length > MAX_ASSEMBLED_BYTES) {
    throw new Error(
      `${TOOL_NAME}: assembled code is ${allBytes.length} bytes, max is ${MAX_ASSEMBLED_BYTES}`,
    );
  }

  return {
    hex: allBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
    bytes: allBytes,
    instructionCount: instructions.length,
    byteLength: allBytes.length,
    engine: 'fallback',
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ── Handler ──

export class AssembleHandlers {
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(
    processManager?: UnifiedProcessManager,
    ctx?: MCPServerContext,
    auditTrail?: MemoryAuditTrail | null,
  ) {
    this.processManager = processManager;
    this.ctx = ctx;
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

  async handleAssemble(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const action = String(args.action ?? '');

      switch (action) {
        case 'assemble':
          return this.handleAssembleOnly(args);
        case 'assemble_at':
          return this.handleAssembleAt(args);
        default:
          throw new Error(
            `${TOOL_NAME}: unknown action "${action}". Expected one of: assemble, assemble_at.`,
          );
      }
    });
  }

  private async handleAssembleOnly(args: Record<string, unknown>) {
    const code = requireStringArg(args.code, 'code', TOOL_NAME);
    const address = typeof args.address === 'number' ? args.address : undefined;

    const result = await assembleAsm(code, address);

    return {
      success: true,
      ...result,
      hint:
        `Assembled ${result.instructionCount} instruction(s) → ${result.byteLength} bytes using ${result.engine} engine.` +
        (result.warnings ? ` ${result.warnings.length} warning(s).` : ''),
    };
  }

  private async handleAssembleAt(args: Record<string, unknown>) {
    const pid = await this.resolvePid(args.pid);
    const targetAddress = validateHexAddress(args.targetAddress, 'targetAddress');
    const code = requireStringArg(args.code, 'code', TOOL_NAME);
    const dryRun = argBool(args, 'dryRun', false);

    const result = await assembleAsm(code, parseInt(targetAddress.replace(/^0x/i, ''), 16));

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        ...result,
        targetAddress,
        pid,
        hint: `Dry run: would write ${result.byteLength} byte(s) to ${targetAddress} (pid ${pid}). Remove dryRun to execute.`,
      };
    }

    // Write assembled bytes to target process via the platform provider
    // (b3-09/a4-01 async migration, commit c047a09b): writeMemory routes through
    // the `.async` worker path instead of MemoryController's synchronous koffi
    // write, keeping the event loop responsive during remote patching. (Hygiene
    // debt: MemoryController's win32 writeBuffer stays synchronous for low-frequency
    // write_value/undo/redo — this destructive patch path bypasses it directly.)
    const start = Date.now();
    try {
      const { createPlatformProvider } = await import('@native/platform/factory.js');
      const provider = createPlatformProvider();
      const memBuf = Buffer.from(result.bytes);
      const addrBig = BigInt(targetAddress.startsWith('0x') ? targetAddress : `0x${targetAddress}`);
      const handle = provider.openProcess(pid, true);
      try {
        await provider.writeMemory(handle, addrBig, memBuf);
      } finally {
        provider.closeProcess(handle);
      }

      this.recordAudit({
        operation: 'assemble_at',
        pid,
        address: targetAddress,
        size: result.byteLength,
        result: 'success',
        durationMs: Date.now() - start,
      });

      return {
        success: true,
        ...result,
        targetAddress,
        pid,
        hint: `Wrote ${result.byteLength} byte(s) to ${targetAddress} (pid ${pid}). Use memory_dump to verify.`,
      };
    } catch (err) {
      this.recordAudit({
        operation: 'assemble_at',
        pid,
        address: targetAddress,
        size: result.byteLength,
        result: 'failure',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      });
      throw err;
    }
  }
}
