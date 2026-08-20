import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FindAccessesHandlers } from '../../../../../src/server/domains/memory/handlers/find-accesses';

/**
 * 16-byte fixture used by the mock memory reader for the "happy path".
 * Deliberately non-zero so tests can assert it's NOT the old fabricated
 * `'00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00'` placeholder.
 */
const REAL_BYTES_16 = '48 89 08 48 8B 0C 25 F8 FF FF FF 90 90 90 90 90';
const PID = 1234;

/** 16-byte all-zero string — the old fabricated placeholder. Used to assert it's gone. */
const OLD_PLACEHOLDER = '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00';

describe('FindAccessesHandlers', () => {
  let handlers: FindAccessesHandlers;

  const BP_ID = 'bp-find-1';
  const ADDRESS = '0x7FF612340000';

  const makeHit = (
    overrides: Partial<{
      instructionAddress: string;
      accessType: string;
      timestamp: number;
      threadId: number;
      breakpointId: string;
    }> = {},
  ) => ({
    breakpointId: overrides.breakpointId ?? BP_ID,
    address: ADDRESS,
    accessAddress: ADDRESS,
    instructionAddress: overrides.instructionAddress ?? '0x7FF612341000',
    threadId: overrides.threadId ?? 5678,
    accessType: overrides.accessType ?? 'write',
    timestamp: overrides.timestamp ?? Date.now(),
    registers: {
      rax: '0x1',
      rbx: '0x2',
      rcx: '0x3',
      rdx: '0x4',
      rsi: '0x5',
      rdi: '0x6',
      rsp: '0x7',
      rbp: '0x8',
      r8: '0x9',
      r9: '0xA',
      r10: '0xB',
      r11: '0xC',
      r12: '0xD',
      r13: '0xE',
      r14: '0xF',
      r15: '0x10',
      rip: overrides.instructionAddress ?? '0x7FF612341000',
      rflags: '0x246',
    },
  });

  const makeBpEngine = () => ({
    setBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    waitForHit: vi.fn(),
    listBreakpoints: vi.fn().mockReturnValue([]),
  });

  /** Mock reader that returns 16 real bytes for any address. */
  const makeReader = (override?: any): any =>
    override ?? vi.fn().mockResolvedValue({ success: true, data: REAL_BYTES_16 });

  /** Async mock disassembler (production DisassemblerFn is now async). */
  const makeDisassembler = (): any => vi.fn().mockResolvedValue('mov [rcx], eax');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('instantiates correctly', () => {
    const bpEngine = makeBpEngine();
    const reader = makeReader();
    const disassembler = makeDisassembler();
    handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);
    expect(handlers).toBeInstanceOf(FindAccessesHandlers);
    expect(typeof handlers.handleFindAccesses).toBe('function');
  });

  describe('handleFindAccesses', () => {
    it('captures hits with auto-rearm and returns per-hit context with REAL bytes + mnemonic', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x7FF612341000' }))
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x7FF612342000' }))
        .mockResolvedValue(null);

      bpEngine.removeBreakpoint.mockResolvedValue(true);
      disassembler.mockResolvedValue('mov [rcx], eax');

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        maxHits: 20,
        timeoutMs: 5000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(2);
      expect(parsed.hitCount).toBe(2);

      // First hit: disassembled with REAL bytes (not the old placeholder)
      expect(parsed.hits[0].instructionAddress).toBe('0x7FF612341000');
      expect(parsed.hits[0].instructionBytes).toBe(REAL_BYTES_16);
      expect(parsed.hits[0].instructionBytes).not.toBe(OLD_PLACEHOLDER);
      expect(parsed.hits[0].instructionMnemonic).toBe('mov [rcx], eax');
      expect(parsed.hits[0].accessType).toBe('write');
      expect(parsed.hits[0].hitCount).toBe(1);

      // Second hit
      expect(parsed.hits[1].instructionAddress).toBe('0x7FF612342000');
      expect(parsed.hits[1].hitCount).toBe(2);

      // Auto-rearm: setBreakpoint called for initial + after hit1 + after hit2 = 3 times
      expect(bpEngine.setBreakpoint).toHaveBeenCalledTimes(3);
      // pid flows through (was previously `undefined`)
      expect(bpEngine.setBreakpoint).toHaveBeenCalledWith(PID, ADDRESS, 'write', 4);
      expect(bpEngine.waitForHit).toHaveBeenCalledTimes(3);
      // Cleanup: remove called during re-arm (hit1, hit2) + finally block = 3 times
      expect(bpEngine.removeBreakpoint).toHaveBeenCalledTimes(3);

      // Reader called once per hit (pid + instructionAddress flow through)
      expect(reader).toHaveBeenCalledTimes(2);
      expect(reader).toHaveBeenNthCalledWith(1, PID, '0x7FF612341000', 16);
      expect(reader).toHaveBeenNthCalledWith(2, PID, '0x7FF612342000', 16);
    });

    it('captures readwrite mode hits', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ accessType: 'write', instructionAddress: '0x1000' }))
        .mockResolvedValueOnce(makeHit({ accessType: 'read', instructionAddress: '0x2000' }))
        .mockResolvedValue(null);

      bpEngine.removeBreakpoint.mockResolvedValue(true);
      disassembler.mockResolvedValue('nop');

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'readwrite',
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(2);
      expect(parsed.hits[0].accessType).toBe('write');
      expect(parsed.hits[1].accessType).toBe('read');
      // Initial call — pid flows through (was previously `undefined`)
      expect(bpEngine.setBreakpoint).toHaveBeenCalledWith(PID, ADDRESS, 'readwrite', 4);
    });

    it('respects maxHits limit', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1100' }))
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1200' }))
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1300' }))
        .mockResolvedValue(null);

      bpEngine.removeBreakpoint.mockResolvedValue(true);
      disassembler.mockResolvedValue('add eax, 1');

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        maxHits: 3,
        timeoutMs: 5000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(3);
      expect(parsed.hitCount).toBe(3);
      expect(parsed.stoppedBy).toBe('maxHits');
      expect(bpEngine.removeBreakpoint).toHaveBeenCalled();
    });

    it('stops on timeout', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValue(null);

      bpEngine.removeBreakpoint.mockResolvedValue(true);
      disassembler.mockResolvedValue('xor eax, eax');

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        maxHits: 50,
        timeoutMs: 100,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(1);
      expect(parsed.stoppedBy).toBe('timeout');
    });

    it('returns raw instruction bytes when disassemble=false (still reads REAL bytes)', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValue(null);

      bpEngine.removeBreakpoint.mockResolvedValue(true);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        disassemble: false,
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(1);
      // instructionBytes is the REAL data from the reader, not fabricated zeros
      expect(parsed.hits[0].instructionBytes).toBe(REAL_BYTES_16);
      expect(parsed.hits[0].instructionBytes).not.toBe(OLD_PLACEHOLDER);
      expect(parsed.hits[0].instructionMnemonic).toBeUndefined();
      expect(disassembler).not.toHaveBeenCalled();
    });

    it('returns error for invalid address', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: 'not-a-hex-address',
        mode: 'write',
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('address must be a hex address');
      expect(bpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('returns error when bpEngine is null (unsupported platform)', async () => {
      handlers = new FindAccessesHandlers(null, makeReader(), makeDisassembler());

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('only supported on Windows');
    });

    it('rejects invalid mode', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'execute',
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid mode');
      expect(bpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('rejects invalid size', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        size: 3,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"size"');
      expect(bpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('accepts valid sizes 1, 2, 4, 8', async () => {
      for (const size of [1, 2, 4, 8]) {
        const bpEngine = makeBpEngine();
        const reader = makeReader();
        const disassembler = makeDisassembler();
        const h = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

        bpEngine.setBreakpoint.mockResolvedValue({ id: `bp-${size}`, address: ADDRESS });
        bpEngine.waitForHit.mockResolvedValue(null);
        bpEngine.removeBreakpoint.mockResolvedValue(true);
        bpEngine.listBreakpoints.mockReturnValue([]);

        const response = await h.handleFindAccesses({
          pid: PID,
          address: ADDRESS,
          mode: 'write',
          size,
          timeoutMs: 100,
        });

        const parsed = JSON.parse((response.content[0] as any).text);
        expect(parsed.success).toBe(true);
        // pid flows through for every valid size (was previously `undefined`)
        expect(bpEngine.setBreakpoint).toHaveBeenCalledWith(PID, ADDRESS, 'write', size);
      }
    });

    it('returns summary when no hits captured within timeout', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });
      bpEngine.waitForHit.mockResolvedValue(null);
      bpEngine.removeBreakpoint.mockResolvedValue(true);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 100,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(0);
      expect(parsed.hitCount).toBe(0);
      expect(parsed.hint).toContain('No accesses');
    });
  });

  // ── New tests covering the bug fix (real-byte read + honest null fallback + pid flow) ──

  describe('real instruction-byte read (bug fix)', () => {
    it('produces a mnemonic from real bytes via the injected reader + disassembler', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x7FF612341000' }))
        .mockResolvedValue(null);
      bpEngine.removeBreakpoint.mockResolvedValue(true);
      disassembler.mockResolvedValue('mov rax, 0x1');

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(1);

      const hit = parsed.hits[0];
      // The reader's bytes flow through to instructionBytes
      expect(hit.instructionBytes).toBe(REAL_BYTES_16);
      // The disassembler receives the bytes parsed into a number[] + the instruction address
      expect(disassembler).toHaveBeenCalledTimes(1);
      const [bytesArg, addrArg] = disassembler.mock.calls[0]!;
      expect(addrArg).toBe('0x7FF612341000');
      expect(Array.isArray(bytesArg)).toBe(true);
      expect(bytesArg).toHaveLength(16);
      // 0x48 = 72
      expect(bytesArg[0]).toBe(0x48);
      expect(hit.instructionMnemonic).toBe('mov rax, 0x1');
    });

    it('returns instructionBytes=null + no mnemonic when the read fails (honest fallback)', async () => {
      const bpEngine = makeBpEngine();
      const reader = vi.fn().mockResolvedValue({
        success: false,
        error: 'ReadProcessMemory failed: access denied',
      });
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValue(null);
      bpEngine.removeBreakpoint.mockResolvedValue(true);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(1);

      const hit = parsed.hits[0];
      // Honest: null bytes, not fabricated zeros
      expect(hit.instructionBytes).toBeNull();
      expect(hit.instructionBytes).not.toBe(OLD_PLACEHOLDER);
      expect(hit.instructionMnemonic).toBeUndefined();
      // Disassembler is NOT called when the read failed
      expect(disassembler).not.toHaveBeenCalled();
      // Hint surfaces the read failure count to the user
      expect(parsed.hint).toContain('unreadable instruction bytes');
    });

    it('returns instructionBytes=null when the reader throws (defensive try/catch)', async () => {
      const bpEngine = makeBpEngine();
      const reader = vi.fn().mockRejectedValue(new Error('koffi FFI crash'));
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValue(null);
      bpEngine.removeBreakpoint.mockResolvedValue(true);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits[0].instructionBytes).toBeNull();
      expect(parsed.hits[0].instructionMnemonic).toBeUndefined();
      expect(disassembler).not.toHaveBeenCalled();
    });

    it('returns instructionBytes=null on short read (fewer than 16 bytes)', async () => {
      const bpEngine = makeBpEngine();
      // Only 8 bytes returned — partial read near a page boundary
      const reader = vi.fn().mockResolvedValue({
        success: true,
        data: '48 89 08 48 8B 0C 25 F8',
      });
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValue(null);
      bpEngine.removeBreakpoint.mockResolvedValue(true);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      // Short read → honest null (don't disassemble partial instruction data)
      expect(parsed.hits[0].instructionBytes).toBeNull();
      expect(parsed.hits[0].instructionMnemonic).toBeUndefined();
      expect(disassembler).not.toHaveBeenCalled();
    });

    it('returns instructionBytes=null when memoryReader is null (honest fallback, no fabrication)', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      // reader = null — production wiring failed / test scenario
      handlers = new FindAccessesHandlers(bpEngine as any, null, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValue(null);
      bpEngine.removeBreakpoint.mockResolvedValue(true);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits[0].instructionBytes).toBeNull();
      expect(parsed.hits[0].instructionBytes).not.toBe(OLD_PLACEHOLDER);
      expect(parsed.hits[0].instructionMnemonic).toBeUndefined();
      expect(disassembler).not.toHaveBeenCalled();
    });
  });

  describe('pid flow', () => {
    it('throws when pid is missing and no processManager is wired (no undefined → native)', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      // No processManager → resolveMemoryDomainPid validates inline.
      // The old code passed `undefined as unknown as number` to setBreakpoint.
      // The fix surfaces this as a clear error before reaching the bp engine.
      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 100,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid PID');
      expect(bpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('pid flows through to both setBreakpoint and the byte read', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0xDEADBEEF' }))
        .mockResolvedValue(null);
      bpEngine.removeBreakpoint.mockResolvedValue(true);

      const CUSTOM_PID = 9876;
      await handlers.handleFindAccesses({
        pid: CUSTOM_PID,
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 100,
      });

      // setBreakpoint receives the real pid (initial set + re-arm after hit)
      expect(bpEngine.setBreakpoint).toHaveBeenCalledWith(CUSTOM_PID, ADDRESS, 'write', 4);
      // The byte read also receives the real pid
      expect(reader).toHaveBeenCalledWith(CUSTOM_PID, '0xDEADBEEF', 16);
    });
  });

  describe('disassembler failure handling', () => {
    it('sets instructionMnemonic to "(disassembly failed)" when disassembler throws', async () => {
      const bpEngine = makeBpEngine();
      const reader = makeReader();
      const disassembler = vi.fn().mockRejectedValue(new Error('capstone init failed'));
      handlers = new FindAccessesHandlers(bpEngine as any, reader, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValue(null);
      bpEngine.removeBreakpoint.mockResolvedValue(true);

      const response = await handlers.handleFindAccesses({
        pid: PID,
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      // Bytes are still real (read succeeded) — only disassembly failed
      expect(parsed.hits[0].instructionBytes).toBe(REAL_BYTES_16);
      expect(parsed.hits[0].instructionMnemonic).toBe('(disassembly failed)');
    });
  });
});
