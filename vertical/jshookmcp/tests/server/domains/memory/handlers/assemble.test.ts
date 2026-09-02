import { describe, it, expect, vi } from 'vitest';
import { assembleAsm } from '../../../../../src/server/domains/memory/handlers/assemble';

const factoryState = vi.hoisted(() => ({
  openProcess: vi.fn(),
  writeMemory: vi.fn(),
  closeProcess: vi.fn(),
}));

// Lock the assemble_at write path onto a fake provider so the b3-09/a4-01
// createPlatformProvider() migration is exercised (not the real FFI provider).
// Mirrors tests/modules/process/memory/reader.test.ts:35.
vi.mock('@native/platform/factory.js', () => ({
  createPlatformProvider: vi.fn(() => ({
    openProcess: factoryState.openProcess,
    writeMemory: factoryState.writeMemory,
    closeProcess: factoryState.closeProcess,
  })),
}));

function parseResponse(response: unknown): Record<string, unknown> {
  const r = response as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text);
}

describe('assembleAsm (fallback engine)', () => {
  describe('basic instructions', () => {
    it('assembles NOP', async () => {
      const result = await assembleAsm('nop');
      expect(result.bytes).toEqual([0x90]);
      expect(result.hex).toBe('90');
      expect(result.instructionCount).toBe(1);
      expect(result.byteLength).toBe(1);
    });

    it('assembles RET', async () => {
      const result = await assembleAsm('ret');
      expect(result.bytes).toEqual([0xc3]);
      expect(result.hex).toBe('C3');
    });

    it('assembles INT3', async () => {
      const result = await assembleAsm('int3');
      expect(result.bytes).toEqual([0xcc]);
    });

    it('assembles NOP; RET; INT3 as multi-instruction', async () => {
      const result = await assembleAsm('nop; ret; int3');
      expect(result.bytes).toEqual([0x90, 0xc3, 0xcc]);
      expect(result.instructionCount).toBe(3);
      expect(result.byteLength).toBe(3);
      expect(result.hex).toBe('90 C3 CC');
    });

    it('assembles multi-line input', async () => {
      const result = await assembleAsm('nop\nret\nint3');
      expect(result.bytes).toEqual([0x90, 0xc3, 0xcc]);
      expect(result.instructionCount).toBe(3);
    });
  });

  describe('register instructions', () => {
    it('assembles MOV rax, 0x1234', async () => {
      const result = await assembleAsm('mov rax, 0x1234');
      expect(result.bytes[0]).toBe(0x48); // REX.W
      expect(result.bytes[1]).toBe(0xb8); // MOV r64, imm64 (rax)
      // Bytes 2-9: 0x34, 0x12, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
      expect(result.bytes[2]).toBe(0x34);
      expect(result.bytes[3]).toBe(0x12);
      expect(result.byteLength).toBe(10);
    });

    it('assembles PUSH rax', async () => {
      const result = await assembleAsm('push rax');
      expect(result.bytes).toEqual([0x50]);
    });

    it('assembles PUSH rbx', async () => {
      const result = await assembleAsm('push rbx');
      expect(result.bytes).toEqual([0x53]); // 0x50 + 3
    });

    it('assembles POP rax', async () => {
      const result = await assembleAsm('pop rax');
      expect(result.bytes).toEqual([0x58]);
    });

    it('assembles XOR rax, rax (zeroing idiom)', async () => {
      const result = await assembleAsm('xor rax, rax');
      expect(result.bytes[0]).toBe(0x48); // REX.W
      expect(result.bytes[1]).toBe(0x31); // XOR r/m64, r64
      expect(result.bytes[2]).toBe(0xc0); // ModRM: rax, rax
    });

    it('assembles INC rax', async () => {
      const result = await assembleAsm('inc rax');
      expect(result.bytes[0]).toBe(0x48); // REX.W
      expect(result.bytes[1]).toBe(0xff); // INC r/m64
      expect(result.bytes[2]).toBe(0xc0); // ModRM: /0
    });

    it('assembles DEC rcx', async () => {
      const result = await assembleAsm('dec rcx');
      expect(result.bytes[0]).toBe(0x48);
      expect(result.bytes[1]).toBe(0xff);
      expect(result.bytes[2]).toBe(0xc9); // ModRM: rcx, /1
    });
  });

  describe('errors and edge cases', () => {
    it('throws on empty input', async () => {
      await expect(assembleAsm('')).rejects.toThrow('no instructions');
    });

    it('returns fallback engine flag', async () => {
      const result = await assembleAsm('nop');
      expect(result.engine).toBe('fallback');
    });

    it('produces warnings for unsupported instructions with fallback placeholder', async () => {
      const result = await assembleAsm('vaddps ymm0, ymm1, ymm2');
      expect(result.engine).toBe('fallback');
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0]).toContain('fallback');
      // Placeholder INT3 for unsupported
      expect(result.bytes).toEqual([0xcc]);
    });

    it('assembles RET with immediate', async () => {
      const result = await assembleAsm('ret 0x10');
      expect(result.bytes).toEqual([0xc2, 0x10, 0x00]);
    });
  });
});

describe('AssembleHandlers (handler-level)', () => {
  let handlers: import('../../../../../src/server/domains/memory/handlers/assemble').AssembleHandlers;

  it('instantiates correctly', async () => {
    const { AssembleHandlers } =
      await import('../../../../../src/server/domains/memory/handlers/assemble');
    handlers = new AssembleHandlers();
    expect(handlers).toBeInstanceOf(AssembleHandlers);
  });

  it('handleAssemble dispatches assemble action', async () => {
    const { AssembleHandlers } =
      await import('../../../../../src/server/domains/memory/handlers/assemble');
    handlers = new AssembleHandlers();
    const response = await handlers.handleAssemble({
      action: 'assemble',
      code: 'nop; ret',
    });
    const parsed = parseResponse(response);
    expect(parsed.success).toBe(true);
    expect(parsed.bytes).toEqual([0x90, 0xc3]);
    expect(parsed.instructionCount).toBe(2);
    expect(parsed.engine).toBe('fallback');
  });

  it('handleAssemble rejects unknown action', async () => {
    const { AssembleHandlers } =
      await import('../../../../../src/server/domains/memory/handlers/assemble');
    handlers = new AssembleHandlers();
    const response = await handlers.handleAssemble({
      action: 'bogus',
    });
    const parsed = parseResponse(response);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('unknown action');
  });

  it('handleAssemble assemble_at dryRun returns preview without writing', async () => {
    const { AssembleHandlers } =
      await import('../../../../../src/server/domains/memory/handlers/assemble');
    handlers = new AssembleHandlers();
    const response = await handlers.handleAssemble({
      action: 'assemble_at',
      code: 'nop; nop; nop',
      targetAddress: '0x7FF612340000',
      pid: 1234,
      dryRun: true,
    });
    const parsed = parseResponse(response);
    expect(parsed.success).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.byteLength).toBe(3);
  });

  it('handleAssemble requires code for assemble', async () => {
    const { AssembleHandlers } =
      await import('../../../../../src/server/domains/memory/handlers/assemble');
    handlers = new AssembleHandlers();
    const response = await handlers.handleAssemble({
      action: 'assemble',
    });
    const parsed = parseResponse(response);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('code');
  });

  it('handleAssemble assemble_at writes via platform provider and records audit', async () => {
    const handle = { pid: 1234, writeAccess: true };
    factoryState.openProcess.mockReturnValue(handle);
    factoryState.writeMemory.mockResolvedValue({ bytesWritten: 1 });

    const record = vi.fn();
    const { AssembleHandlers } =
      await import('../../../../../src/server/domains/memory/handlers/assemble');
    handlers = new AssembleHandlers(undefined, undefined, { record } as any);

    const response = await handlers.handleAssemble({
      action: 'assemble_at',
      code: 'nop',
      targetAddress: '0x7FF612340000',
      pid: 1234,
    });
    const parsed = parseResponse(response);

    expect(parsed.success).toBe(true);
    // Lock: the write path must route through the platform provider
    // (b3-09/a4-01 async migration), not a synchronous MemoryController call.
    expect(factoryState.openProcess).toHaveBeenCalledWith(1234, true);
    expect(factoryState.writeMemory).toHaveBeenCalledTimes(1);
    expect(factoryState.writeMemory.mock.calls[0]![0]).toEqual(handle);
    expect(factoryState.writeMemory.mock.calls[0]![1]).toBe(BigInt('0x7FF612340000'));
    expect(factoryState.writeMemory.mock.calls[0]![2]).toEqual(Buffer.from([0x90]));
    expect(factoryState.closeProcess).toHaveBeenCalledWith(handle);
    // Audit call preserved through the provider migration.
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'assemble_at', result: 'success', pid: 1234 }),
    );
  });
});
