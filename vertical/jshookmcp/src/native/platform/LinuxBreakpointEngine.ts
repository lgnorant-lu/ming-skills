/**
 * Linux hardware breakpoint engine — ptrace PTRACE_POKEUSER debug registers.
 *
 * Sets/clears x86-64 hardware watchpoints using DR0-DR3 via ptrace.
 * Unlike LinuxInt3AccessBreakpoint (which patches INT3/BRK for execute
 * breakpoints), this engine sets real hardware debug registers so the
 * kernel traps on data access (read/write/readwrite) and instruction
 * fetch (execute) at byte granularity — matching the Win32
 * HardwareBreakpointEngine capability on Linux.
 *
 * Prerequisite: CAP_SYS_PTRACE (or same-uid target with Yama
 * ptrace_scope permitting).
 *
 * @module platform/LinuxBreakpointEngine
 */

import { randomUUID } from 'node:crypto';
import { requireKoffi, type KoffiLibraryHandle } from '../koffi-loader';
import { BREAKPOINT_HIT_TIMEOUT_MS, BREAKPOINT_TRACE_MAX_HITS } from '@src/constants';
import type {
  BreakpointAccess,
  BreakpointConfig,
  BreakpointHit,
  BreakpointListEntry,
  BreakpointSize,
} from '@native/HardwareBreakpoint.types';
import { formatAddress } from '../formatAddress';
import { encodeDR7 } from '../Win32Debug';
import { sleep, allocateDR as allocateDebugRegister } from './utils';

// ── ptrace constants ────────────────────────────────────────────────────

const PTRACE_ATTACH = 16;
const PTRACE_DETACH = 17;
const PTRACE_CONT = 7;
const PTRACE_SINGLESTEP = 9;
const PTRACE_GETREGS = 12;
const PTRACE_PEEKUSER = 3; // read from user area (debug regs)
const PTRACE_POKEUSER = 5; // write to user area  (debug regs)

// ── debug register offsets in struct user (x86-64 Linux) ────────────────
// offsetof(struct user, u_debugreg[N]) — values verified on Linux 5.15+ x64.
// DR4/DR5 are reserved (return -EIO when accessed). DR6 is debug status.

const OFF_DR0 = 848;
const OFF_DR1 = 856;
const OFF_DR2 = 864;
const OFF_DR3 = 872;
const OFF_DR6 = 896;
const OFF_DR7 = 904;

const DR_ADDR_OFFSETS = [OFF_DR0, OFF_DR1, OFF_DR2, OFF_DR3] as const;

// ── x86-64 user_regs_struct offsets (216 B; mirrors LinuxPtraceHelper) ──
//   r15(0) r14(8) r13(16) r12(24) rbp(32) rbx(40) r11(48) r10(56)
//   r9(64) r8(72) rax(80) rcx(88) rdx(96) rsi(104) rdi(112) orig_rax(120)
//   rip(128) cs(136) eflags(144) rsp(152) ss(160)

const OFF_R15 = 0;
const OFF_R14 = 8;
const OFF_R13 = 16;
const OFF_R12 = 24;
const OFF_RBP = 32;
const OFF_RBX = 40;
const OFF_R11 = 48;
const OFF_R10 = 56;
const OFF_R9 = 64;
const OFF_R8 = 72;
const OFF_RAX = 80;
const OFF_RCX = 88;
const OFF_RDX = 96;
const OFF_RSI = 104;
const OFF_RDI = 112;
const OFF_EFLAGS = 144;
const OFF_RSP = 152;
const OFF_RIP = 128;
const REGS_SIZE = 216;

// ── waitpid / signal constants ──────────────────────────────────────────

const WNOHANG = 1;
const SIGSTOP = 19;
const SIGTRAP = 5;

interface ActiveBreakpoint extends BreakpointConfig {
  drIndex: number;
  hitCount: number;
  lastHit?: number;
}

// ── koffi FFI caches (mirrors LinuxPtraceHelper) ────────────────────────

let _libc: KoffiLibraryHandle | null = null;

function libc(): KoffiLibraryHandle {
  if (!_libc) _libc = requireKoffi().load('libc.so.6');
  return _libc;
}

type KoffiFunc = (...args: unknown[]) => unknown;

let _ptraceFn: KoffiFunc | null = null;
function ptraceFn(): KoffiFunc {
  if (!_ptraceFn) {
    _ptraceFn = libc().func('long ptrace(long, int, void *, void *)') as KoffiFunc;
  }
  return _ptraceFn;
}

let _waitpidFn: KoffiFunc | null = null;
function waitpidFn(): KoffiFunc {
  if (!_waitpidFn) {
    _waitpidFn = libc().func('int waitpid(int, _Out_ int *, int)') as KoffiFunc;
  }
  return _waitpidFn;
}

// ── ptrace helpers ──────────────────────────────────────────────────────

function ptrace(req: number, pid: number, addr: number, data: bigint): bigint {
  // PTRACE_POKEUSER takes the offset as addr (int) and the value as data (void*).
  return ptraceFn()(BigInt(req), pid, addr, data) as bigint;
}

function peekUser(pid: number, offset: number): bigint {
  const val = ptrace(PTRACE_PEEKUSER, pid, offset, 0n);
  if (val === -1n && requireKoffi().errno() !== 0) {
    throw new Error(`LinuxBP: PTRACE_PEEKUSER failed at offset ${offset} for pid ${pid}`);
  }
  return val & 0xffffffffffffffffn;
}

function pokeUser(pid: number, offset: number, value: bigint): void {
  ptrace(PTRACE_POKEUSER, pid, offset, value & 0xffffffffffffffffn);
}

function getRegs(pid: number): Buffer {
  const buf = Buffer.alloc(REGS_SIZE);
  ptraceFn()(BigInt(PTRACE_GETREGS), pid, 0, requireKoffi().address(buf) as bigint);
  return buf;
}

/** Blocking waitpid; returns status word or 0 on failure. */
function waitpidBlocking(pid: number): number {
  const st = Buffer.alloc(4);
  const ret = waitpidFn()(pid, requireKoffi().address(st), 0) as number;
  return ret > 0 ? st.readInt32LE(0) : 0;
}

/** Non-blocking (WNOHANG) waitpid; returns {pid, status}. */
function waitpidNoHang(): { pid: number; status: number } {
  const st = Buffer.alloc(4);
  const ret = waitpidFn()(-1, requireKoffi().address(st), WNOHANG) as number;
  return { pid: ret, status: st.readInt32LE(0) };
}

function wifStopped(status: number): boolean {
  return (status & 0xff) === 0x7f;
}

function wstopSig(status: number): number {
  return (status >>> 8) & 0xff;
}

// ── engine ──────────────────────────────────────────────────────────────

export class LinuxBreakpointEngine {
  private breakpoints = new Map<string, ActiveBreakpoint>();
  private attachedPids = new Set<number>();
  private drAllocation = [false, false, false, false]; // DR0-DR3

  async attach(pid: number): Promise<void> {
    this.guardPlatform();
    if (this.attachedPids.has(pid)) return;

    if (ptrace(PTRACE_ATTACH, pid, 0, 0n) !== 0n) {
      throw new Error(`LinuxBP: PTRACE_ATTACH failed for pid ${pid}`);
    }
    const status = waitpidBlocking(pid);
    if (!wifStopped(status) || wstopSig(status) !== SIGSTOP) {
      throw new Error(
        `LinuxBP: attach did not yield SIGSTOP for pid ${pid} (status=0x${status.toString(16)})`,
      );
    }
    this.attachedPids.add(pid);
  }

  async detach(pid: number): Promise<void> {
    this.guardPlatform();

    // Remove all breakpoints for this pid
    for (const [id, bp] of this.breakpoints) {
      if (bp.pid === pid) {
        this.breakpoints.delete(id);
        this.clearDR(pid, bp.drIndex);
        this.drAllocation[bp.drIndex] = false;
      }
    }

    if (this.attachedPids.has(pid)) {
      try {
        ptrace(PTRACE_DETACH, pid, 0, 0n);
      } catch {
        // best-effort
      }
      this.attachedPids.delete(pid);
    }
  }

  async setBreakpoint(
    pid: number,
    address: string,
    access: BreakpointAccess,
    size: BreakpointSize = 4,
  ): Promise<BreakpointConfig> {
    this.guardPlatform();

    if (!this.attachedPids.has(pid)) {
      await this.attach(pid);
    }

    const drIndex = this.allocateDR();
    const targetAddr = BigInt(address.startsWith('0x') ? address : `0x${address}`);

    this.writeDrToProcess(pid, drIndex, targetAddr, access, size, true);

    const config: ActiveBreakpoint = {
      id: randomUUID(),
      pid,
      address: `0x${targetAddr.toString(16).toUpperCase()}`,
      access,
      size,
      enabled: true,
      drIndex,
      hitCount: 0,
    };

    this.breakpoints.set(config.id, config);
    return config;
  }

  async removeBreakpoint(id: string): Promise<boolean> {
    const bp = this.breakpoints.get(id);
    if (!bp) return false;

    this.breakpoints.delete(id);
    this.clearDR(bp.pid, bp.drIndex);
    this.drAllocation[bp.drIndex] = false;
    return true;
  }

  listBreakpoints(): BreakpointListEntry[] {
    return Array.from(this.breakpoints.values()).map((bp) => ({
      id: bp.id,
      address: bp.address,
      access: bp.access,
      size: bp.size,
      enabled: bp.enabled,
      hitCount: bp.hitCount,
      lastHit: bp.lastHit,
    }));
  }

  async waitForHit(timeoutMs?: number): Promise<BreakpointHit | null> {
    this.guardPlatform();
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const { pid, status } = waitpidNoHang();

      if (pid === 0) {
        await sleep(2);
        continue;
      }
      if (pid < 0) break;

      if (wifStopped(status) && wstopSig(status) === SIGTRAP) {
        const hit = this.processHit(pid);
        if (hit) {
          // Single-step past the trap so the tracee can continue.
          ptrace(PTRACE_SINGLESTEP, pid, 0, 0n);
          waitpidBlocking(pid);
          // Clear DR6 so the kernel doesn't re-deliver the trap.
          pokeUser(pid, OFF_DR6, 0n);
          ptrace(PTRACE_CONT, pid, 0, 0n);
          return hit;
        }
        // Unknown SIGTRAP — continue.
        ptrace(PTRACE_CONT, pid, 0, 0n);
      } else if (wifStopped(status)) {
        ptrace(PTRACE_CONT, pid, 0, BigInt(wstopSig(status)));
      }
    }

    return null;
  }

  async traceAccess(
    pid: number,
    address: string,
    access: BreakpointAccess,
    maxHits?: number,
    timeoutMs?: number,
  ): Promise<BreakpointHit[]> {
    const max = maxHits ?? BREAKPOINT_TRACE_MAX_HITS;
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const bp = await this.setBreakpoint(pid, address, access);
    const hits: BreakpointHit[] = [];

    const deadline = Date.now() + timeout;
    while (hits.length < max && Date.now() < deadline) {
      const hit = await this.waitForHit(Math.min(1000, deadline - Date.now()));
      if (hit?.breakpointId === bp.id) {
        hits.push(hit);
      }
    }

    await this.removeBreakpoint(bp.id);
    return hits;
  }

  // ── private ──

  private guardPlatform(): void {
    if (process.platform !== 'linux') {
      throw new Error(
        `LinuxBreakpointEngine requires process.platform === 'linux' (got '${process.platform}')`,
      );
    }
  }

  private allocateDR(): number {
    return allocateDebugRegister(this.drAllocation);
  }

  /**
   * Write debug register values into the tracee via PTRACE_POKEUSER.
   *
   * ptrace operates on a **stopped** tracee, so we pause it, write the
   * DR values, then resume.
   */
  private writeDrToProcess(
    pid: number,
    drIndex: number,
    address: bigint,
    access: BreakpointAccess,
    size: BreakpointSize,
    enable: boolean,
  ): void {
    const drAddrOffset = DR_ADDR_OFFSETS[drIndex]!;

    if (enable) {
      pokeUser(pid, drAddrOffset, address);
    } else {
      pokeUser(pid, drAddrOffset, 0n);
    }

    // Build DR7 from active breakpoints for this pid
    const drAccessMap: Record<BreakpointAccess, 'execute' | 'write' | 'readwrite' | 'read'> = {
      execute: 'execute',
      write: 'write',
      readwrite: 'readwrite',
      read: 'read',
    };

    const entries = Array.from(this.breakpoints.values())
      .filter((bp) => bp.enabled && bp.pid === pid)
      .map((bp) => ({
        drIndex: bp.drIndex,
        enabled: true,
        access: drAccessMap[bp.access],
        size: bp.size,
      }));

    if (enable) {
      entries.push({
        drIndex,
        enabled: true,
        access: drAccessMap[access],
        size,
      });
    }

    const dr7 = encodeDR7(entries);
    pokeUser(pid, OFF_DR7, dr7);
  }

  private clearDR(pid: number, drIndex: number): void {
    const dummyAccess: BreakpointAccess = 'write';
    this.writeDrToProcess(pid, drIndex, 0n, dummyAccess, 1, false);
  }

  /** Read DR6 and resolve which breakpoint was hit. */
  private processHit(pid: number): BreakpointHit | null {
    const dr6 = peekUser(pid, OFF_DR6);
    const regs = getRegs(pid);

    for (const [id, bp] of this.breakpoints) {
      if (bp.pid !== pid) continue;
      const drBit = 1n << BigInt(bp.drIndex);
      if (dr6 & drBit) {
        bp.hitCount++;
        bp.lastHit = Date.now();

        return {
          breakpointId: id,
          address: bp.address,
          accessAddress: bp.address,
          instructionAddress: formatAddress(regs.readBigUInt64LE(OFF_RIP)),
          threadId: pid,
          accessType: bp.access,
          timestamp: Date.now(),
          registers: {
            rax: formatAddress(regs.readBigUInt64LE(OFF_RAX)),
            rbx: formatAddress(regs.readBigUInt64LE(OFF_RBX)),
            rcx: formatAddress(regs.readBigUInt64LE(OFF_RCX)),
            rdx: formatAddress(regs.readBigUInt64LE(OFF_RDX)),
            rsi: formatAddress(regs.readBigUInt64LE(OFF_RSI)),
            rdi: formatAddress(regs.readBigUInt64LE(OFF_RDI)),
            rsp: formatAddress(regs.readBigUInt64LE(OFF_RSP)),
            rbp: formatAddress(regs.readBigUInt64LE(OFF_RBP)),
            r8: formatAddress(regs.readBigUInt64LE(OFF_R8)),
            r9: formatAddress(regs.readBigUInt64LE(OFF_R9)),
            r10: formatAddress(regs.readBigUInt64LE(OFF_R10)),
            r11: formatAddress(regs.readBigUInt64LE(OFF_R11)),
            r12: formatAddress(regs.readBigUInt64LE(OFF_R12)),
            r13: formatAddress(regs.readBigUInt64LE(OFF_R13)),
            r14: formatAddress(regs.readBigUInt64LE(OFF_R14)),
            r15: formatAddress(regs.readBigUInt64LE(OFF_R15)),
            rip: formatAddress(regs.readBigUInt64LE(OFF_RIP)),
            rflags: formatAddress(regs.readBigUInt64LE(OFF_EFLAGS)),
          },
        };
      }
    }

    return null;
  }
}
