/**
 * Tests for memory_find_references — cross-reference engine.
 *
 * Tests the scanForReferences pure function (no native deps) with crafted
 * x64 byte buffers, plus handler-level integration tests with mocked platform API.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { scanForReferences } from '../../../../src/server/domains/memory/handlers/find-references';

// ── Helpers ──

/** Convert a number to a bigint address. */
function addr(n: number): bigint {
  return BigInt(n);
}

// ── Unit tests: scanForReferences ──

describe('scanForReferences (pure byte-pattern scanner)', () => {
  it('detects CALL rel32 reference', () => {
    // CALL 0x1000 at address 0x5000:
    // E8 = CALL opcode
    // rel32 = target - (insn + 5) = 0x1000 - 0x5005 = 0xFFFFF00B (signed) = -0xFFB
    const target = addr(0x1000);
    const insnAddr = addr(0x5000);
    const rel32 = Number(BigInt(target) - BigInt(insnAddr) - 5n);
    expect(rel32).toBeLessThan(0);

    const buf = Buffer.alloc(5);
    buf[0] = 0xe8;
    buf.writeInt32LE(rel32, 1);

    const hits = scanForReferences(buf, insnAddr, target, null, null);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.type).toBe('CALL');
    expect(hits[0]!.fromAddress).toBe('0x5000');
  });

  it('detects JMP rel32 reference', () => {
    // JMP 0x2000 at address 0x3000:
    // rel32 = 0x2000 - 0x3005 = 0xFFFFEFFB (-0x1005)
    const target = addr(0x2000);
    const insnAddr = addr(0x3000);
    const rel32 = Number(BigInt(target) - BigInt(insnAddr) - 5n);

    const buf = Buffer.alloc(5);
    buf[0] = 0xe9;
    buf.writeInt32LE(rel32, 1);

    const hits = scanForReferences(buf, insnAddr, target, null, null);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.type).toBe('JMP');
  });

  it('detects Jcc rel32 (conditional jump) reference', () => {
    // JE 0x4000 at address 0x5000 (0F 84 ...)
    // rel32 = 0x4000 - 0x5006 = -0x1006
    const target = addr(0x4000);
    const insnAddr = addr(0x5000);
    const rel32 = Number(BigInt(target) - BigInt(insnAddr) - 6n);

    const buf = Buffer.alloc(6);
    buf[0] = 0x0f;
    buf[1] = 0x84; // JE
    buf.writeInt32LE(rel32, 2);

    const hits = scanForReferences(buf, insnAddr, target, null, null);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.type).toBe('JMP');
  });

  it('detects LEA [RIP+disp32] reference', () => {
    // 48 8D 05 XX XX XX XX = LEA RAX, [RIP+disp32]
    // At address 0x6000, target = 0x7000
    // disp32 = 0x7000 - 0x6007 = 0xFF9
    const target = addr(0x7000);
    const insnAddr = addr(0x6000);
    const disp32 = Number(BigInt(target) - BigInt(insnAddr) - 7n);

    const buf = Buffer.alloc(7);
    buf[0] = 0x48;
    buf[1] = 0x8d;
    buf[2] = 0x05; // ModRM: mod=00, reg=000, rm=101
    buf.writeInt32LE(disp32, 3);

    const hits = scanForReferences(buf, insnAddr, target, null, null);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.type).toBe('LEA');
  });

  it('detects MOV [RIP+disp32] reference', () => {
    // 48 8B 0D XX XX XX XX = MOV RCX, [RIP+disp32]
    const target = addr(0x8000);
    const insnAddr = addr(0x7000);
    const disp32 = Number(BigInt(target) - BigInt(insnAddr) - 7n);

    const buf = Buffer.alloc(7);
    buf[0] = 0x48;
    buf[1] = 0x8b;
    buf[2] = 0x0d; // ModRM: mod=00, reg=001, rm=101
    buf.writeInt32LE(disp32, 3);

    const hits = scanForReferences(buf, insnAddr, target, null, null);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.type).toBe('MOV');
  });

  it('does not match non-referencing instructions', () => {
    // CALL to 0x9000, but our target is 0x1000
    const target = addr(0x1000);
    const insnAddr = addr(0x5000);
    const callTarget = addr(0x9000);
    const rel32 = Number(BigInt(callTarget) - BigInt(insnAddr) - 5n);

    const buf = Buffer.alloc(5);
    buf[0] = 0xe8;
    buf.writeInt32LE(rel32, 1);

    const hits = scanForReferences(buf, insnAddr, target, null, null);
    expect(hits).toHaveLength(0);
  });

  it('returns module offset correctly', () => {
    // CALL at 0x5100 in module at 0x5000, target = 0x1000
    const target = addr(0x1000);
    const insnAddr = addr(0x5100);
    const moduleBase = addr(0x5000);
    const rel32 = Number(BigInt(target) - BigInt(insnAddr) - 5n);

    const buf = Buffer.alloc(5);
    buf[0] = 0xe8;
    buf.writeInt32LE(rel32, 1);

    const hits = scanForReferences(buf, insnAddr, target, moduleBase, 'test.dll');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.module).toBe('test.dll');
    expect(hits[0]!.offset).toBe('+0x100');
  });
});

// ── Handler integration tests ──

describe('FindReferencesHandlers', () => {
  let handler: InstanceType<
    typeof import('../../../../src/server/domains/memory/handlers/find-references').FindReferencesHandlers
  >;

  beforeEach(async () => {
    const mod = await import('../../../../src/server/domains/memory/handlers/find-references');
    handler = new mod.FindReferencesHandlers();
  });

  it('rejects invalid hex address', async () => {
    const result = await handler.handleFindReferences({
      pid: 1234,
      address: 'not-a-hex-address!!!',
    });
    const parsed = JSON.parse(JSON.stringify(result));
    expect(parsed.content[0].text).toContain('success');
    expect(parsed.content[0].text).toContain('false');
  });

  it('rejects missing address', async () => {
    const result = await handler.handleFindReferences({ pid: 1234 });
    const parsed = JSON.parse(JSON.stringify(result));
    const text = parsed.content[0].text;
    expect(text).toContain('success');
    // missing address should fail validation
    expect(text).toContain('false');
  });
});
