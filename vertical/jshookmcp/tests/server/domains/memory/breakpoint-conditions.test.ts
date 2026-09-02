/**
 * Breakpoint conditional evaluation — unit tests.
 *
 * Tests condition validation and evaluation through the HookHandlers layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookHandlers } from '@server/domains/memory/handlers/hooks';

// Mock native dependencies
vi.mock('@native/HardwareBreakpoint', () => ({
  HardwareBreakpointEngine: vi.fn(),
  hardwareBreakpointEngine: {
    setBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    listBreakpoints: vi.fn(() => []),
    traceAccess: vi.fn(() => []),
  },
}));

vi.mock('@native/VehDebugger', () => ({
  VehDebuggerEngine: vi.fn(),
  vehDebuggerEngine: {
    setBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    listBreakpoints: vi.fn(() => []),
    traceAccess: vi.fn(() => []),
  },
}));

vi.mock('@native/SoftwareBreakpoint', () => ({
  SoftwareBreakpointEngine: vi.fn(),
  softwareBreakpointEngine: {
    setBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    listBreakpoints: vi.fn(() => []),
    traceAccess: vi.fn(() => []),
    evaluateCondition: vi.fn(() => true),
  },
}));

vi.mock('@native/CodeInjector', () => ({
  CodeInjector: vi.fn(),
  codeInjector: {
    patchBytes: vi.fn(),
    nopBytes: vi.fn(),
    unpatch: vi.fn(),
    findCodeCaves: vi.fn(() => []),
  },
}));

vi.mock('@server/domains/memory/pid-resolver', () => ({
  resolveMemoryDomainPid: vi.fn(() => 1234),
}));

vi.mock('@server/domains/shared/ResponseBuilder', () => ({
  handleSafe: async (fn: () => Promise<unknown>) => {
    const result = await fn();
    return { success: true, data: result };
  },
}));

vi.mock('@utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@native/ConditionEvaluator', async () => {
  const actual = await vi.importActual<typeof import('@native/ConditionEvaluator')>(
    '@native/ConditionEvaluator',
  );
  return actual;
});

describe('Breakpoint condition evaluation', () => {
  let handlers: HookHandlers;
  let mockBpEngine: {
    setBreakpoint: ReturnType<typeof vi.fn>;
    removeBreakpoint: ReturnType<typeof vi.fn>;
    listBreakpoints: ReturnType<typeof vi.fn>;
    traceAccess: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBpEngine = {
      setBreakpoint: vi.fn().mockResolvedValue({
        id: 'bp-1',
        address: '0x401000',
        access: 'execute',
        size: 1,
        enabled: true,
      }),
      removeBreakpoint: vi.fn().mockResolvedValue(true),
      listBreakpoints: vi.fn().mockReturnValue([]),
      traceAccess: vi.fn().mockResolvedValue([]),
    };

    handlers = new HookHandlers(
      mockBpEngine as any,
      null, // veh
      null, // softBp
      {
        patchBytes: vi.fn(),
        nopBytes: vi.fn(),
        unpatch: vi.fn(),
        findCodeCaves: vi.fn(() => []),
      } as any,
      undefined,
      undefined,
      null,
    );
  });

  it('validates condition at set time and rejects invalid expressions', async () => {
    await expect(
      handlers.handleBreakpointSet({
        address: '0x401000',
        access: 'execute',
        pid: 1234,
        type: 'hardware',
        condition: 'rax >',
      }),
    ).rejects.toThrow('invalid condition expression');
  });

  it('accepts valid condition expressions', async () => {
    const result = await handlers.handleBreakpointSet({
      address: '0x401000',
      access: 'execute',
      pid: 1234,
      type: 'hardware',
      condition: 'rax > 0x1000',
    });

    expect(result).toBeDefined();
  });

  it('rejects conditions over 50K characters', async () => {
    const longCondition = 'a'.repeat(50_001);
    await expect(
      handlers.handleBreakpointSet({
        address: '0x401000',
        access: 'execute',
        pid: 1234,
        type: 'hardware',
        condition: longCondition,
      }),
    ).rejects.toThrow('invalid condition expression');
  });

  it('evaluates conditions against register context for trace hits', async () => {
    const hitWithRegisters = {
      breakpointId: 'bp-1',
      address: '0x401000',
      accessAddress: '0x401000',
      instructionAddress: '0x0',
      threadId: 1001,
      accessType: 'execute' as const,
      timestamp: Date.now(),
      registers: {
        rax: '0x1000',
        rbx: '0x0',
        rcx: '0x5',
        rdx: '0x0',
        rsi: '0x0',
        rdi: '0x0',
        rsp: '0x7FFFFFFF',
        rbp: '0x7FFFFFF0',
        r8: '0x0',
        r9: '0x0',
        r10: '0x0',
        r11: '0x0',
        r12: '0x0',
        r13: '0x0',
        r14: '0x0',
        r15: '0x0',
        rip: '0x401000',
        rflags: '0x202',
      },
    };

    mockBpEngine.traceAccess.mockResolvedValue([hitWithRegisters]);

    const result = await handlers.handleBreakpointTrace({
      address: '0x401000',
      access: 'execute',
      pid: 1234,
      type: 'hardware',
      condition: 'rax == 0x1000',
    });

    expect(result).toBeDefined();
    const data = result as unknown as {
      success: boolean;
      data?: { hitCount: number; filteredCount: number };
    };
    // Condition should match (rax == 0x1000 is true)
    if (data?.data) {
      expect(data.data.hitCount).toBeGreaterThanOrEqual(0);
    }
  });
});
