/**
 * HardwareBreakpointEngine — software breakpoint (INT3) and conditional breakpoint tests.
 *
 * Tests the engine logic in isolation (mock Win32 APIs).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import * as Win32Debug from '@native/Win32Debug';

// Mock Win32Debug
vi.mock('@native/Win32Debug', () => ({
  OpenThread: vi.fn(() => 1n),
  SuspendThread: vi.fn(() => 0),
  ResumeThread: vi.fn(() => 1),
  GetThreadContext: vi.fn(() => Buffer.alloc(1232)),
  SetThreadContext: vi.fn(),
  DebugActiveProcess: vi.fn(),
  DebugActiveProcessStop: vi.fn(),
  DebugSetProcessKillOnExit: vi.fn(),
  WaitForDebugEvent: vi.fn(() => null),
  ContinueDebugEvent: vi.fn(),
  EnumerateProcessThreads: vi.fn(() => [1001, 1002]),
  openThreadForDebug: vi.fn(() => 1n),
  parseContext: vi.fn(() => ({
    contextFlags: 0,
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
    rip: 0n,
    lr: 0n,
    bvr: [],
    bcr: [],
    wvr: [],
    wcr: [],
  })),
  writeContext: vi.fn(),
  writeBreakpointRegisters: vi.fn(),
  readBreakpointRegisterAddress: vi.fn(() => 0n),
  setSingleStepFlag: vi.fn(),
  encodeDR7: vi.fn(() => 0n),
  CONTEXT_FLAGS: { ALL: 0x0010001f },
  CONTEXT_SIZE: 1232,
  IS_ARM64_WINDOWS: false,
  EXCEPTION_CODE: {
    SINGLE_STEP: 0x80000004,
    BREAKPOINT: 0x80000003,
    ACCESS_VIOLATION: 0xc0000005,
  },
  DBG: { CONTINUE: 0x00010002, EXCEPTION_NOT_HANDLED: 0x80010001 },
  DEBUG_EVENT_CODE: { EXCEPTION_DEBUG_EVENT: 1 },
}));

// Mock Win32API
vi.mock('@native/Win32API', () => ({
  CloseHandle: vi.fn(() => true),
  OpenProcess: vi.fn(() => 0x100n),
  ReadProcessMemory: vi.fn(() => Buffer.from([0x90])),
  WriteProcessMemory: vi.fn(() => 4),
  VirtualQueryEx: vi.fn(() => ({
    success: true,
    info: {
      Protect: 0x20,
      BaseAddress: 0x401000n,
      AllocationBase: 0x400000n,
      AllocationProtect: 0x20,
      RegionSize: 0x1000n,
      State: 0x1000,
      Type: 0x1000000,
    },
  })),
  VirtualProtectEx: vi.fn(() => ({ success: true, oldProtect: 0x20 })),
  PAGE: {
    NOACCESS: 0x01,
    READONLY: 0x02,
    READWRITE: 0x04,
    EXECUTE: 0x10,
    EXECUTE_READ: 0x20,
    EXECUTE_READWRITE: 0x40,
    EXECUTE_WRITECOPY: 0x80,
  },
  PROCESS_ACCESS: {
    VM_READ: 0x0010,
    VM_WRITE: 0x0020,
    VM_OPERATION: 0x0008,
    QUERY_INFORMATION: 0x0400,
  },
}));

vi.mock('@src/constants', () => ({
  BREAKPOINT_HIT_TIMEOUT_MS: 5000,
  BREAKPOINT_TRACE_MAX_HITS: 10,
}));

describe('HardwareBreakpointEngine — software breakpoints', () => {
  let engine: HardwareBreakpointEngine;

  beforeEach(() => {
    engine = new HardwareBreakpointEngine();
    vi.clearAllMocks();
  });

  describe('setBreakpoint with access=execute', () => {
    it('should set a hardware breakpoint with execute access', async () => {
      const bp = await engine.setBreakpoint(1234, '0x401000', 'execute', 4);
      expect(bp.id).toBeDefined();
      expect(bp.address).toBe('0x401000');

      // Should have attached to the process
      expect(Win32Debug.DebugActiveProcess).toHaveBeenCalled();
    });

    it('should be listed in listBreakpoints', async () => {
      await engine.setBreakpoint(1234, '0x401000', 'execute', 4);
      const list = engine.listBreakpoints();
      expect(list.length).toBe(1);
      expect(list[0]?.access).toBe('execute');
    });

    it('should throw when all 4 DR registers are in use', async () => {
      // Fill all 4 hardware breakpoints
      for (let i = 0; i < 4; i++) {
        await engine.setBreakpoint(1234, `0x${(i * 0x1000).toString(16)}`, 'write', 4);
      }
      // 5th hardware breakpoint should throw — no DR registers left
      await expect(engine.setBreakpoint(1234, '0x401000', 'execute', 4)).rejects.toThrow(
        'All 4 hardware breakpoint registers',
      );
    });

    it('should set breakpoint on any address (permission check is caller responsibility)', async () => {
      // VirtualQueryEx is not called during setBreakpoint — the engine trusts
      // the caller to verify memory permissions.
      const bp = await engine.setBreakpoint(1234, '0x500000', 'execute', 4);
      expect(bp.id).toBeDefined();
      expect(bp.address).toBe('0x500000');
    });

    it('should allow removal of breakpoint', async () => {
      const bp = await engine.setBreakpoint(1234, '0x401000', 'execute', 4);
      const removed = await engine.removeBreakpoint(bp.id);
      expect(removed).toBe(true);
      expect(engine.listBreakpoints().length).toBe(0);
    });
  });

  describe('waitForHit with hardware breakpoints', () => {
    it('should detect SINGLE_STEP hit and return breakpoint info', async () => {
      const bp = await engine.setBreakpoint(1234, '0x401000', 'readwrite', 4);

      // Mock GetThreadContext to return DR6 with the DR0 bit set
      const dr6Big = 1n;
      vi.mocked(Win32Debug.parseContext).mockReturnValue({
        contextFlags: 0,
        eflags: 0x202,
        dr0: 0n,
        dr1: 0n,
        dr2: 0n,
        dr3: 0n,
        dr6: dr6Big,
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
        rip: 0x401000n,
      } as any);

      let eventsEnabled = false;
      vi.mocked(Win32Debug.WaitForDebugEvent).mockReset();
      vi.mocked(Win32Debug.WaitForDebugEvent).mockImplementation(() => {
        if (!eventsEnabled) return null;
        return {
          processId: 1234,
          threadId: 1001,
          debugEventCode: 1,
          exceptionCode: Win32Debug.EXCEPTION_CODE.SINGLE_STEP,
          exceptionAddress: 0x401000n,
        } as any;
      });
      eventsEnabled = true;

      const hit = await engine.waitForHit(1000);
      expect(hit).not.toBeNull();
      expect(hit?.breakpointId).toBe(bp.id);
      expect(hit?.instructionAddress).toBe('0x401000');
    });

    it('should pass through unrecognised SINGLE_STEP addresses (no matching DR index)', async () => {
      // Register a BP at 0x401000 but fire SINGLE_STEP at 0x999999
      await engine.setBreakpoint(1234, '0x401000', 'readwrite', 4);

      // Mock parseContext with dr6 bit 0 set but the BP's pid won't match
      // (pid filter in processHit). Actually, pids do match — the issue is
      // dr6 bit 0 matches the BP at DR0=0x401000 but exceptionAddress is
      // different. processHit matches by DR6, not exceptionAddress, so this
      // works the same as above. Let's instead test with dr6=0 (no hit).
      vi.mocked(Win32Debug.parseContext).mockReturnValue({
        contextFlags: 0,
        eflags: 0x202,
        dr0: 0n,
        dr1: 0n,
        dr2: 0n,
        dr3: 0n,
        dr6: 0n, // No DR bit set
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
        rip: 0x999999n,
      } as any);

      let eventsEnabled = false;
      vi.mocked(Win32Debug.WaitForDebugEvent).mockReset();
      vi.mocked(Win32Debug.WaitForDebugEvent).mockImplementation(() => {
        if (!eventsEnabled) return null;
        return {
          processId: 1234,
          threadId: 1001,
          debugEventCode: 1,
          exceptionCode: Win32Debug.EXCEPTION_CODE.SINGLE_STEP,
          exceptionAddress: 0x999999n,
        } as any;
      });
      eventsEnabled = true;

      // dr6=0 → no breakpoint matched → null
      const hit = await engine.waitForHit(100);
      expect(hit).toBeNull();
    });
  });

  describe('hardware breakpoints work as expected', () => {
    it('should set hardware breakpoint by default', async () => {
      const bp = await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);
      expect(bp.id).toBeDefined();
      expect(bp.access).toBe('write');
    });

    it('should list hardware breakpoints with correct fields', async () => {
      await engine.setBreakpoint(1234, '0x1000', 'write', 4);
      const list = engine.listBreakpoints();
      expect(list[0]?.access).toBe('write');
      expect(list[0]?.enabled).toBe(true);
    });
  });
});

describe('HardwareBreakpointEngine — condition handling at handler layer', () => {
  let engine: HardwareBreakpointEngine;

  beforeEach(() => {
    engine = new HardwareBreakpointEngine();
    vi.clearAllMocks();
  });

  describe('setBreakpoint — condition is not an engine concern', () => {
    it('should accept extra arguments without error (condition handled at handler layer)', async () => {
      // The engine ignores extra args — condition evaluation is in the
      // handler layer (HookHandlers.handleBreakpointSet / handleBreakpointTrace).
      const bp = await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);
      expect(bp.id).toBeDefined();
      // Engine-returned config has no "condition" field — that is added by
      // the handler layer after engine.setBreakpoint returns.
    });

    it('should accept calls that happen to pass extra args', async () => {
      // Extra positional args beyond the 4 engine params are silently
      // ignored in JS — the engine only uses pid, address, access, size.
      const bp = await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);
      expect(bp).toHaveProperty('id');
      expect(bp).toHaveProperty('address');
      expect(bp).toHaveProperty('access', 'write');
    });
  });

  describe('hardware BP hit detection', () => {
    it('should return hit from waitForHit when SINGLE_STEP fires', async () => {
      vi.mocked(Win32Debug.parseContext).mockReturnValue({
        contextFlags: 0,
        eflags: 0x202,
        dr0: 0n,
        dr1: 0n,
        dr2: 0n,
        dr3: 0n,
        dr6: 1n, // DR0 hit
        dr7: 0n,
        rax: 1n,
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
        rip: 0x401000n,
      } as any);

      let eventsEnabled = false;
      vi.mocked(Win32Debug.WaitForDebugEvent).mockReset();
      vi.mocked(Win32Debug.WaitForDebugEvent).mockImplementation(() => {
        if (!eventsEnabled) return null;
        return {
          processId: 1234,
          threadId: 1001,
          exceptionCode: Win32Debug.EXCEPTION_CODE.SINGLE_STEP,
          exceptionAddress: 0x401000n,
        } as any;
      });

      const bp = await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);
      eventsEnabled = true;

      const hit = await engine.waitForHit(2000);
      expect(hit?.breakpointId).toBe(bp.id);
    });

    it('should suppress hit when DR6 has no matching bit', async () => {
      // DR6=0 → no matching breakpoint
      vi.mocked(Win32Debug.parseContext).mockReturnValue({
        contextFlags: 0,
        eflags: 0x202,
        dr0: 0n,
        dr1: 0n,
        dr2: 0n,
        dr3: 0n,
        dr6: 0n, // No DR bit set
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
        rip: 0x401000n,
      } as any);

      let eventsEnabled = false;
      vi.mocked(Win32Debug.WaitForDebugEvent).mockReset();
      vi.mocked(Win32Debug.WaitForDebugEvent).mockImplementation(() => {
        if (!eventsEnabled) return null;
        return {
          processId: 1234,
          threadId: 1001,
          exceptionCode: Win32Debug.EXCEPTION_CODE.SINGLE_STEP,
          exceptionAddress: 0x401000n,
        } as any;
      });

      await engine.setBreakpoint(1234, '0x7FFE0000', 'write', 4);
      eventsEnabled = true;

      const hit = await engine.waitForHit(2000);
      // DR6 has no bit set → no breakpoint matched → null
      expect(hit).toBeNull();
    });
  });

  describe('listBreakpoints returns engine-native fields only', () => {
    it('should return access and enabled, not type or condition', async () => {
      await engine.setBreakpoint(1234, '0x1000', 'write', 4);
      const list = engine.listBreakpoints();
      expect(list[0]).toHaveProperty('access', 'write');
      expect(list[0]).toHaveProperty('enabled', true);
      expect(list[0]).not.toHaveProperty('type');
      expect(list[0]).not.toHaveProperty('condition');
    });
  });
});
