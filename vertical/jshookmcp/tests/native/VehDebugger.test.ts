/**
 * VehDebuggerEngine — unit tests.
 *
 * Tests the VEH debugger engine in isolation with mocked koffi and Win32 APIs.
 * All FFI calls are mocked so tests run on any platform, not just Windows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VehDebuggerEngine } from '@native/VehDebugger';

// ── Mock koffi ──
const mockKernel32 = {
  func: vi.fn((signature: string) => {
    const funcMap: Record<string, () => unknown> = {
      'void *GetModuleHandleA(const char *)': () => 0x7ffe0000n,
      'void *GetProcAddress(void *, const char *)': () => 0x7ffe1000n,
      'void *CreateEventW(void *, int, int, _In_ uint16_t *)': () => 0x100n,
      'void *CreateFileMappingW(void *, void *, uint32, uint32, uint32, _In_ uint16_t *)': () =>
        0x200n,
      'void *MapViewOfFile(void *, uint32, uint32, uint32, size_t)': () => 0x300n,
      'void *CreateRemoteThread(void *, void *, size_t, void *, void *, uint32, void *)': () =>
        0x400n,
      'uint32 WaitForSingleObject(void *, uint32)': () => 0,
      'uint32 WaitForMultipleObjects(uint32, void **, int, uint32)': () => 0xffffffff,
      'void *memcpy(void *, void *, size_t)': () => 0,
    };
    return funcMap[signature] ?? vi.fn(() => 0);
  }),
};

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => mockKernel32),
  },
}));

// ── Mock Win32Debug ──
vi.mock('@native/Win32Debug', () => ({
  OpenThread: vi.fn(() => 1n),
  SuspendThread: vi.fn(() => 0),
  ResumeThread: vi.fn(() => 1),
  GetThreadContext: vi.fn(() => {
    const buf = Buffer.alloc(1232);
    buf.writeUInt32LE(0x0010001f, 0x30);
    return buf;
  }),
  SetThreadContext: vi.fn(),
  EnumerateProcessThreads: vi.fn(() => [1001]),
  openThreadForDebug: vi.fn(() => 1n),
  parseContext: vi.fn(() => ({
    contextFlags: 0x0010001f,
    eflags: 0x202,
    dr0: 0n,
    dr1: 0n,
    dr2: 0n,
    dr3: 0n,
    dr6: 0n,
    dr7: 0n,
    rax: 0n,
    rcx: 0n,
    rdx: 0n,
    rbx: 0n,
    rsp: 0n,
    rbp: 0n,
    rsi: 0n,
    rdi: 0n,
    r8: 0n,
    r9: 0n,
    r10: 0n,
    r11: 0n,
    r12: 0n,
    r13: 0n,
    r14: 0n,
    r15: 0n,
    rip: 0x7ffe1234n,
  })),
  writeContext: vi.fn(),
  writeBreakpointRegisters: vi.fn(),
  readBreakpointRegisterAddress: vi.fn(() => 0n),
  setSingleStepFlag: vi.fn(),
  encodeDR7: vi.fn(() => 0n),
  CONTEXT_FLAGS: { ALL: 0x0010001f },
  CONTEXT_SIZE: 1232,
  IS_ARM64_WINDOWS: false,
  EXCEPTION_CODE: { SINGLE_STEP: 0x80000004 },
  DBG: { CONTINUE: 0x00010002 },
}));

// ── Mock Win32API ──
vi.mock('@native/Win32API', () => ({
  CloseHandle: vi.fn(),
  openProcessForMemory: vi.fn(() => 0x500n),
  VirtualAllocEx: vi.fn(() => 0x600n),
  VirtualFreeEx: vi.fn(),
  WriteProcessMemory: vi.fn(),
  PAGE: { EXECUTE_READWRITE: 0x40, READWRITE: 0x04 },
  MEM: { COMMIT: 0x1000, RESERVE: 0x2000, RELEASE: 0x8000 },
}));

vi.mock('@src/constants', () => ({
  BREAKPOINT_HIT_TIMEOUT_MS: 5000,
  BREAKPOINT_TRACE_MAX_HITS: 10,
}));

describe('VehDebuggerEngine', () => {
  let engine: VehDebuggerEngine;

  beforeEach(() => {
    engine = new VehDebuggerEngine();
    vi.clearAllMocks();
  });

  // ── Construction ──

  it('instantiates correctly', () => {
    expect(engine).toBeInstanceOf(VehDebuggerEngine);
  });

  // ── setBreakpoint ──

  describe('setBreakpoint', () => {
    it('should attach and set a breakpoint with correct config', async () => {
      const bp = await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);

      expect(bp.id).toBeDefined();
      expect(bp.pid).toBe(1234);
      expect(bp.address).toBe('0x7FFE0000');
      expect(bp.access).toBe('write');
      expect(bp.size).toBe(4);
      expect(bp.enabled).toBe(true);
    });

    it('should allocate DR0-DR3 and throw on 5th', async () => {
      for (let i = 0; i < 4; i++) {
        await engine.setBreakpoint(1234, `0x${(0x7ffe0000 + i * 0x10).toString(16)}`, 'write', 4);
      }

      await expect(engine.setBreakpoint(1234, '0x7FFE0050', 'write', 4)).rejects.toThrow(/DR0-DR3/);
    });

    it('should auto-attach on first setBreakpoint call', async () => {
      const bp = await engine.setBreakpoint(5678, '0x1000', 'execute', 1);
      expect(bp.pid).toBe(5678);
      expect(bp.access).toBe('execute');

      const list = engine.listBreakpoints();
      expect(list).toHaveLength(1);
      expect(list[0]!.enabled).toBe(true);
    });
  });

  // ── removeBreakpoint ──

  describe('removeBreakpoint', () => {
    it('should remove breakpoint and free DR register', async () => {
      const bp = await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);
      expect(engine.listBreakpoints()).toHaveLength(1);

      const removed = await engine.removeBreakpoint(bp.id);
      expect(removed).toBe(true);
      expect(engine.listBreakpoints()).toHaveLength(0);

      // DR freed: can set again (4 DR registers now all available)
      const bp2 = await engine.setBreakpoint(1234, '0x7FFE0010', 'readwrite', 8);
      expect(bp2.id).toBeDefined();
    });

    it('should return false for unknown id', async () => {
      expect(await engine.removeBreakpoint('nonexistent')).toBe(false);
    });
  });

  // ── listBreakpoints ──

  describe('listBreakpoints', () => {
    it('should return all active breakpoints ordered by set', async () => {
      await engine.setBreakpoint(1234, '0x1000', 'write', 4);
      await engine.setBreakpoint(1234, '0x2000', 'read', 2);

      const list = engine.listBreakpoints();
      expect(list).toHaveLength(2);
      expect(list[0]!.address).toBe('0x1000');
      expect(list[0]!.access).toBe('write');
      expect(list[0]!.size).toBe(4);
      expect(list[1]!.address).toBe('0x2000');
      expect(list[1]!.access).toBe('read');
      expect(list[1]!.size).toBe(2);
      expect(list[0]!.hitCount).toBe(0);
    });
  });

  // ── waitForHit ──

  describe('waitForHit', () => {
    it('should return null after timeout when no events fire', async () => {
      const hit = await engine.waitForHit(200);
      expect(hit).toBeNull();
    });

    it('should return null when no sessions exist', async () => {
      // Call without any setBreakpoint first
      const e2 = new VehDebuggerEngine();
      const hit = await e2.waitForHit(100);
      expect(hit).toBeNull();
    });
  });

  // ── traceAccess ──

  describe('traceAccess', () => {
    it('should return empty array when no hits fire', async () => {
      const hits = await engine.traceAccess(9999, '0xDEAD0000', 'write', 3, 500);
      expect(Array.isArray(hits)).toBe(true);
      expect(hits).toHaveLength(0);
    });

    it('should clean up breakpoint after trace completes', async () => {
      await engine.traceAccess(9999, '0xBEEF0000', 'execute', 2, 200);
      // Breakpoint should be removed after trace
      expect(engine.listBreakpoints()).toHaveLength(0);
    });
  });

  // ── attach / detach lifecycle ──

  describe('attach/detach lifecycle', () => {
    it('should attach and be idempotent', async () => {
      await engine.setBreakpoint(1000, '0xA000', 'write', 4);
      // Second setBreakpoint on same pid should not crash
      await engine.setBreakpoint(1000, '0xA010', 'write', 4);
      expect(engine.listBreakpoints()).toHaveLength(2);
    });

    it('should detach and release all breakpoints', async () => {
      await engine.setBreakpoint(2000, '0xB000', 'write', 4);
      expect(engine.listBreakpoints()).toHaveLength(1);

      await engine.detach(2000);
      expect(engine.listBreakpoints()).toHaveLength(0);
    });
  });
});
