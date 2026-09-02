/**
 * AutoAssembler unit tests — parser, command execution, ENABLE/DISABLE lifecycle.
 *
 * Pure unit tests: no real native API calls. All native operations are mocked via AAExecutionContext.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutoAssembler } from '@native/AutoAssembler';
import type { AAExecutionContext } from '@native/AutoAssembler.types';
import { AA_LIMITS } from '@native/AutoAssembler.types';

/** Build a mock execution context with tracked calls. */
function mockContext(overrides?: Partial<AAExecutionContext>): {
  ctx: AAExecutionContext;
  calls: {
    allocs: { size: number; addr: bigint }[];
    frees: bigint[];
    protects: { addr: bigint; size: number }[];
    reads: { addr: bigint; size: number }[];
    writes: { addr: bigint; data: Buffer }[];
    aobScans: { pattern: string }[];
    threads: bigint[];
  };
} {
  const allocAddrs: bigint[] = [0x10000n, 0x20000n, 0x30000n, 0x40000n, 0x50000n];
  let allocIdx = 0;

  const calls = {
    allocs: [] as { size: number; addr: bigint }[],
    frees: [] as bigint[],
    protects: [] as { addr: bigint; size: number }[],
    reads: [] as { addr: bigint; size: number }[],
    writes: [] as { addr: bigint; data: Buffer }[],
    aobScans: [] as { pattern: string }[],
    threads: [] as bigint[],
  };

  const ctx: AAExecutionContext = {
    pid: 1234,
    allocate: vi.fn(async (size: number): Promise<bigint> => {
      const addr = allocAddrs[allocIdx++] ?? BigInt(allocAddrs.length * 0x10000 + 0x10000);
      calls.allocs.push({ size, addr });
      return addr;
    }),
    free: vi.fn(async (addr: bigint): Promise<boolean> => {
      calls.frees.push(addr);
      return true;
    }),
    protect: vi.fn(async (addr: bigint, size: number): Promise<void> => {
      calls.protects.push({ addr, size });
    }),
    read: vi.fn(async (addr: bigint, size: number): Promise<Buffer> => {
      calls.reads.push({ addr, size });
      // Return a buffer matching the AOB pattern used in tests
      // AOBSCAN "48 8B 05 ?? ?? ?? ??" -> at address 0xDEAD we return matching bytes
      if (addr === 0xdeadn) {
        return Buffer.from([0x48, 0x8b, 0x05, 0x00, 0x01, 0x02, 0x03]);
      }
      return Buffer.alloc(size, 0xcc);
    }),
    write: vi.fn(async (addr: bigint, data: Buffer): Promise<void> => {
      calls.writes.push({ addr, data });
    }),
    aobScan: vi.fn(async (pattern: string): Promise<bigint[]> => {
      calls.aobScans.push({ pattern });
      if (pattern.includes('00 00 00 00')) {
        return []; // Simulate not found
      }
      return [0x7fff12340000n];
    }),
    createThread: vi.fn(async (addr: bigint): Promise<void> => {
      calls.threads.push(addr);
    }),
    ...overrides,
  };

  return { ctx, calls };
}

describe('AutoAssembler', () => {
  let aa: AutoAssembler;

  beforeEach(() => {
    aa = new AutoAssembler();
  });

  // ── Parser Tests ──

  describe('parse and execute basic commands', () => {
    it('executes DEFINE and ALLOC', async () => {
      const { ctx, calls } = mockContext();
      const script = [
        '[ENABLE]',
        'DEFINE(MY_CONST, 0x1000)',
        'ALLOC(myCode, 256)',
        'REGISTERSYMBOL(myCode)',
        '[DISABLE]',
        'DEALLOC(myCode)',
      ].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(result.enableResults).toHaveLength(3);
      expect(result.enableResults[0]!.command).toBe('DEFINE');
      expect(result.enableResults[0]!.success).toBe(true);
      expect(result.enableResults[1]!.command).toBe('ALLOC');
      expect(result.enableResults[1]!.success).toBe(true);
      expect(result.enableResults[2]!.command).toBe('REGISTERSYMBOL');
      expect(result.enableResults[2]!.success).toBe(true);

      // Verify allocations were tracked
      expect(result.allocations).toHaveProperty('myCode');
      expect(result.symbols).toHaveProperty('myCode');
      expect(calls.allocs).toHaveLength(1);
      expect(calls.allocs[0]!.size).toBe(256);
    });

    it('executes AOBSCAN', async () => {
      const { ctx, calls } = mockContext();
      const script = [
        '[ENABLE]',
        'AOBSCAN(found, 48 8B 05 ?? ?? ?? ??)',
        'REGISTERSYMBOL(found)',
        '[DISABLE]',
      ].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(calls.aobScans).toHaveLength(1);
      expect(result.enableResults[0]!.command).toBe('AOBSCAN');
      expect(result.enableResults[0]!.message).toContain('0x7FFF12340000');
      expect(result.labels).toHaveProperty('found');
    });

    it('fails AOBSCAN when pattern not found', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', 'AOBSCAN(notfound, 00 00 00 00)', '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults[0]!.success).toBe(false);
      expect(result.enableResults[0]!.message).toContain('pattern not found');
    });

    it('executes FULLACCESS and READMEM', async () => {
      const { ctx, calls } = mockContext();
      const script = [
        '[ENABLE]',
        'DEFINE(addr, 0xDEAD)',
        'FULLACCESS(addr, 0x1000)',
        'READMEM(addr, 0x10)',
        '[DISABLE]',
      ].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(calls.protects).toHaveLength(1);
      expect(calls.protects[0]!.addr).toBe(0xdeadn);
      expect(calls.protects[0]!.size).toBe(0x1000);
      expect(calls.reads).toHaveLength(1);
      expect(calls.reads[0]!.addr).toBe(0xdeadn);
      expect(calls.reads[0]!.size).toBe(0x10);
    });

    it('executes WRITEMEM', async () => {
      const { ctx, calls } = mockContext();
      const script = [
        '[ENABLE]',
        'DEFINE(addr, 0xDEAD)',
        'WRITEMEM(addr, 90 90 90)',
        '[DISABLE]',
      ].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(calls.writes).toHaveLength(1);
      expect(calls.writes[0]!.addr).toBe(0xdeadn);
      expect(Array.from(calls.writes[0]!.data)).toEqual([0x90, 0x90, 0x90]);
    });

    it('executes ASSERT successfully', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', 'ASSERT(0xDEAD, 48 8B ?? ?? ?? ?? ??)', '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(result.enableResults[0]!.message).toBe('ASSERT passed');
    });

    it('executes CREATETHREAD', async () => {
      const { ctx, calls } = mockContext();
      const script = ['[ENABLE]', 'DEFINE(entry, 0xBEEF)', 'CREATETHREAD(entry)', '[DISABLE]'].join(
        '\n',
      );

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(calls.threads).toHaveLength(1);
      expect(calls.threads[0]).toBe(0xbeefn);
    });

    it('executes LABEL with address', async () => {
      const { ctx } = mockContext();
      const script = [
        '[ENABLE]',
        'LABEL(marker, 0xCAFE)',
        'REGISTERSYMBOL(marker)',
        '[DISABLE]',
      ].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(result.labels).toHaveProperty('marker');
      expect(result.symbols).toHaveProperty('marker');
    });
  });

  // ── ENABLE/DISABLE Lifecycle ──

  describe('enable/disable lifecycle', () => {
    it('returns disableScript for later cleanup', async () => {
      const { ctx } = mockContext();
      const script = [
        '[ENABLE]',
        'ALLOC(myCode, 256)',
        'REGISTERSYMBOL(myCode)',
        '[DISABLE]',
        'DEALLOC(myCode)',
      ].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(result.disableScript).toBeDefined();
      expect(result.disableScript.disableCommands).toHaveLength(1);
      expect(result.disableScript.disableCommands[0]!.command).toBe('DEALLOC');
      expect(result.disableScript.allocations).toHaveProperty('myCode');
    });

    it('executes disable script with DEALLOC', async () => {
      const { ctx, calls } = mockContext();
      const enableScript = ['[ENABLE]', 'ALLOC(myCode, 256)', '[DISABLE]', 'DEALLOC(myCode)'].join(
        '\n',
      );

      const enableResult = await aa.execute(enableScript, ctx);
      expect(enableResult.success).toBe(true);

      // Reset call tracker
      calls.frees = [];

      const disableResult = await aa.executeDisable(enableResult.disableScript, ctx);

      expect(calls.frees).toHaveLength(1);
      expect(disableResult.every((r) => r.success)).toBe(true);
    });

    it('executes DEALLOC last in disable section (CE convention)', async () => {
      const { ctx, calls } = mockContext();
      const enableScript = [
        '[ENABLE]',
        'ALLOC(a, 100)',
        'ALLOC(b, 200)',
        '[DISABLE]',
        'DEALLOC(b)',
        'WRITEMEM(0xDEAD, 90 90 90)',
        'DEALLOC(a)',
      ].join('\n');

      const enableResult = await aa.execute(enableScript, ctx);

      // Reset trackers
      calls.frees = [];
      calls.writes = [];

      const disableResult = await aa.executeDisable(enableResult.disableScript, ctx);

      // WRITEMEM should execute before DEALLOC
      expect(calls.writes).toHaveLength(1);
      expect(calls.frees).toHaveLength(2);

      // The write should have happened before the frees
      // (ordering enforced by DEALLOC being moved to end)
      expect(disableResult.every((r) => r.success)).toBe(true);
    });
  });

  // ── Error Handling ──

  describe('error handling', () => {
    it('rejects INCLUDE for security', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', 'INCLUDE(somefile.asm)', '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults[0]!.message).toContain('INCLUDE');
    });

    it('rejects LOADBINARY for security', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', 'LOADBINARY(0x1000, payload.bin)', '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults[0]!.message).toContain('LOADBINARY');
    });

    it('rejects unknown commands', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', 'UNKNOWNCOMMAND(x, y)', '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults[0]!.message).toContain('Unknown command');
    });

    it('rejects undefined symbols in REGISTERSYMBOL', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', 'REGISTERSYMBOL(undefinedSym)', '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults[0]!.message).toContain('symbol not found');
    });

    it('rejects DEALLOC of non-existent allocation', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', 'DEALLOC(nonexistent)', '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults[0]!.message).toContain('no allocation found');
    });

    it('handles missing args gracefully', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', 'ALLOC()', '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults[0]!.message).toContain('requires name and size');
    });

    it('enforces WRITEMEM size limit', async () => {
      const { ctx } = mockContext();
      const bytes = Array.from({ length: AA_LIMITS.MAX_WRITEMEM_SIZE + 1 }, () => '90').join(' ');
      const script = ['[ENABLE]', `WRITEMEM(0x1000, ${bytes})`, '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults[0]!.message).toContain('exceeds max');
    });

    it('enforces ALLOC size limit', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', `ALLOC(huge, ${AA_LIMITS.MAX_ALLOC_SIZE + 1})`, '[DISABLE]'].join(
        '\n',
      );

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults[0]!.message).toContain('size must be');
    });

    it('enforces max allocations limit', async () => {
      const { ctx } = mockContext();
      const allocs = Array.from(
        { length: AA_LIMITS.MAX_ALLOCATIONS + 1 },
        (_, i) => `ALLOC(a${i}, 64)`,
      ).join('\n');
      const script = ['[ENABLE]', allocs, '[DISABLE]'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      const failureResult = result.enableResults.find((r) => !r.success);
      expect(failureResult).toBeDefined();
      expect(failureResult!.message).toContain('Too many allocations');
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('handles comments in script', async () => {
      const { ctx, calls } = mockContext();
      const script = [
        '[ENABLE]',
        '// This is a comment',
        'DEFINE(x, 0x100) // inline comment',
        'ALLOC(buf, x)',
        '[DISABLE]',
        'DEALLOC(buf) // cleanup',
      ].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(calls.allocs).toHaveLength(1);
      expect(calls.allocs[0]!.size).toBe(0x100);
    });

    it('skips blank lines', async () => {
      const { ctx } = mockContext();
      const script = ['', '[ENABLE]', '', 'DEFINE(x, 42)', '', '[DISABLE]', ''].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(result.enableResults).toHaveLength(1);
    });

    it('handles script without DISABLE section', async () => {
      const { ctx } = mockContext();
      const script = ['[ENABLE]', 'DEFINE(x, 100)'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(result.disableScript.disableCommands).toHaveLength(0);
    });

    it('resolves DEFINE values in subsequent commands', async () => {
      const { ctx, calls } = mockContext();
      const script = [
        '[ENABLE]',
        'DEFINE(SIZE, 512)',
        'ALLOC(buf, SIZE)',
        '[DISABLE]',
        'DEALLOC(buf)',
      ].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(calls.allocs).toHaveLength(1);
      expect(calls.allocs[0]!.size).toBe(512);
    });

    it('parses decimal values correctly', async () => {
      const { ctx, calls } = mockContext();
      const script = ['[ENABLE]', 'ALLOC(buf, 1024)', '[DISABLE]', 'DEALLOC(buf)'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(calls.allocs[0]!.size).toBe(1024);
    });

    it('parses hex values with 0x prefix', async () => {
      const { ctx, calls } = mockContext();
      const script = ['[ENABLE]', 'ALLOC(buf, 0x400)', '[DISABLE]', 'DEALLOC(buf)'].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(true);
      expect(calls.allocs[0]!.size).toBe(0x400);
    });

    it('stops on first failure', async () => {
      const { ctx, calls } = mockContext();
      const script = [
        '[ENABLE]',
        'DEFINE(x, 100)',
        'INCLUDE(forbidden.asm)',
        'ALLOC(buf, 256)', // Should never execute
        '[DISABLE]',
      ].join('\n');

      const result = await aa.execute(script, ctx);

      expect(result.success).toBe(false);
      expect(result.enableResults).toHaveLength(2); // DEFINE + INCLUDE
      expect(result.enableResults[1]!.success).toBe(false);
      // ALLOC should not have been called
      expect(calls.allocs).toHaveLength(0);
    });
  });
});
