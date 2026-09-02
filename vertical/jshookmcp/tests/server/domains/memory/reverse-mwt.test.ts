/**
 * Tests for memory_reverse_mwt — reverse memory write trace.
 *
 * Tests parseAccessedAddresses (pure function) plus handler integration.
 */

import { describe, it, expect } from 'vitest';
import { parseAccessedAddresses } from '../../../../src/server/domains/memory/handlers/reverse-mwt';

// ── Unit tests: parseAccessedAddresses ──

describe('parseAccessedAddresses (pure opStr parser)', () => {
  it('resolves RIP-relative with positive displacement', () => {
    // lea rax, [rip + 0x144ed]
    // instruction at 0x1000, size 7
    // target = 0x1000 + 7 + 0x144ed = 0x154F4
    const opStr = '[rip + 0x144ed]';
    const insnAddr = BigInt(0x1000);
    const insnSize = 7;

    const result = parseAccessedAddresses(opStr, insnAddr, insnSize);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('0x154F4');
    expect(result[0]!.accessType).toBe('RIP_REL');
    expect(result[0]!.resolution).toBe('RIP+0x144ed');
  });

  it('resolves RIP-relative with negative displacement', () => {
    // mov rax, [rip - 0x100]
    // instruction at 0x2000, size 7
    // target = 0x2000 + 7 - 0x100 = 0x1F07
    const opStr = '[rip - 0x100]';
    const insnAddr = BigInt(0x2000);
    const insnSize = 7;

    const result = parseAccessedAddresses(opStr, insnAddr, insnSize);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('0x1F07');
    expect(result[0]!.accessType).toBe('RIP_REL');
  });

  it('resolves RIP-relative without spaces (Capstone compact format)', () => {
    // Some Capstone versions output "rip+0x144ed" without spaces
    const opStr = '[rip+0x100]';
    const insnAddr = BigInt(0x5000);
    const insnSize = 7;

    const result = parseAccessedAddresses(opStr, insnAddr, insnSize);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('0x5107');
  });

  it('detects absolute memory address', () => {
    const opStr = '[0x7FF612340000]';
    const result = parseAccessedAddresses(opStr, BigInt(0), 0);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('0X7FF612340000');
    expect(result[0]!.accessType).toBe('READ');
  });

  it('detects immediate addresses (8+ hex digit constants)', () => {
    // mov rax, 0x7FF612341000
    const opStr = '0x7FF612341000';
    const result = parseAccessedAddresses(opStr, BigInt(0), 0);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('0X7FF612341000');
  });

  it('returns empty for register-relative addressing', () => {
    // mov eax, [rbx + 0x10] — cannot resolve without runtime context
    const opStr = '[rbx + 0x10]';
    const result = parseAccessedAddresses(opStr, BigInt(0), 0);
    expect(result).toHaveLength(0);
  });

  it('returns empty for register-only operands', () => {
    // push rax — no memory access
    const opStr = 'rax';
    const result = parseAccessedAddresses(opStr, BigInt(0), 0);
    expect(result).toHaveLength(0);
  });
});

// ── Handler integration tests ──

describe('ReverseMWTHandlers', () => {
  let handler: InstanceType<
    typeof import('../../../../src/server/domains/memory/handlers/reverse-mwt').ReverseMWTHandlers
  >;

  it('rejects invalid hex address', async () => {
    const mod = await import('../../../../src/server/domains/memory/handlers/reverse-mwt');
    // Create with mock MemoryController that throws on dumpMemory
    const mockMemCtrl = {
      dumpMemory: async () => {
        throw new Error('mock');
      },
    } as any;
    handler = new mod.ReverseMWTHandlers(mockMemCtrl);
    const result = await handler.handleReverseMWT({
      pid: 1234,
      address: 'not-a-hex-address!!!',
    });
    const parsed = JSON.parse(JSON.stringify(result));
    expect(parsed.content[0].text).toContain('false');
  });

  it('rejects missing address', async () => {
    const mod = await import('../../../../src/server/domains/memory/handlers/reverse-mwt');
    const mockMemCtrl = {
      dumpMemory: async () => {
        throw new Error('mock');
      },
    } as any;
    handler = new mod.ReverseMWTHandlers(mockMemCtrl);
    const result = await handler.handleReverseMWT({ pid: 1234 });
    const parsed = JSON.parse(JSON.stringify(result));
    expect(parsed.content[0].text).toContain('false');
  });
});
