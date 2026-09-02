import { describe, it, expect } from 'vitest';
import {
  generateSignature,
  detectRelativeDisplacements,
} from '../../src/native/SignatureGenerator';

describe('SignatureGenerator', () => {
  describe('detectRelativeDisplacements', () => {
    it('detects CALL rel32 (E8)', () => {
      // E8 01 02 03 04 = CALL +0x04030201
      const bytes = Buffer.from([0xe8, 0x01, 0x02, 0x03, 0x04]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(1);
      expect(wc[0]!.offset).toBe(1);
      expect(wc[0]!.length).toBe(4);
      expect(wc[0]!.reason).toContain('CALL rel32');
    });

    it('detects JMP rel32 (E9)', () => {
      const bytes = Buffer.from([0xe9, 0x00, 0x00, 0x00, 0x00]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(1);
      expect(wc[0]!.offset).toBe(1);
      expect(wc[0]!.reason).toContain('JMP rel32');
    });

    it('detects LOOP rel8 (E2)', () => {
      const bytes = Buffer.from([0xe2, 0xfe]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(1);
      expect(wc[0]!.offset).toBe(1);
      expect(wc[0]!.length).toBe(1);
      expect(wc[0]!.reason).toContain('LOOP');
    });

    it('detects Jcc rel32 (0F 8x)', () => {
      // 0F 84 xx xx xx xx = JE rel32
      const bytes = Buffer.from([0x0f, 0x84, 0x00, 0x00, 0x00, 0x00]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(1);
      expect(wc[0]!.offset).toBe(2);
      expect(wc[0]!.length).toBe(4);
      expect(wc[0]!.reason).toContain('Jcc');
    });

    it('detects JNE rel32 (0F 85)', () => {
      const bytes = Buffer.from([0x0f, 0x85, 0x00, 0x00, 0x00, 0x00]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(1);
      expect(wc[0]!.reason).toContain('Jcc');
    });

    it('detects LEA RCX, [RIP+disp32] (48 8D 0D)', () => {
      const bytes = Buffer.from([0x48, 0x8d, 0x0d, 0x00, 0x00, 0x00, 0x00]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(1);
      expect(wc[0]!.offset).toBe(3);
      expect(wc[0]!.length).toBe(4);
      expect(wc[0]!.reason).toContain('LEA');
      expect(wc[0]!.reason).toContain('RIP');
    });

    it('detects LEA RAX, [RIP+disp32] (48 8D 05)', () => {
      const bytes = Buffer.from([0x48, 0x8d, 0x05, 0x00, 0x00, 0x00, 0x00]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(1);
      expect(wc[0]!.offset).toBe(3);
    });

    it('detects MOV [RIP+disp32] (48 8B 0D)', () => {
      const bytes = Buffer.from([0x48, 0x8b, 0x0d, 0x00, 0x00, 0x00, 0x00]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(1);
      expect(wc[0]!.offset).toBe(3);
      expect(wc[0]!.reason).toContain('MOV');
    });

    it('detects CMP [RIP+disp32] (48 3B 0D)', () => {
      const bytes = Buffer.from([0x48, 0x3b, 0x0d, 0x00, 0x00, 0x00, 0x00]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(1);
      expect(wc[0]!.offset).toBe(3);
      expect(wc[0]!.reason).toContain('CMP');
    });

    it('does not wildcard non-RIP-relative LEA', () => {
      // 48 8D 44 24 08 = LEA RAX, [RSP+8] — not RIP-relative
      const bytes = Buffer.from([0x48, 0x8d, 0x44, 0x24, 0x08]);
      const wc = detectRelativeDisplacements(bytes);
      // ModRM 0x44: Mod=01, Reg=RAX(000), R/M=100 (SIB follows)
      expect(wc).toHaveLength(0);
    });

    it('handles non-relative instructions without wildcarding', () => {
      // MOV EAX, 0x12345678 (B8 78 56 34 12)
      const bytes = Buffer.from([0xb8, 0x78, 0x56, 0x34, 0x12]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(0);
    });

    it('handles empty buffer', () => {
      const bytes = Buffer.alloc(0);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(0);
    });

    it('detects multiple relative instructions in sequence', () => {
      // CALL + JMP
      const bytes = Buffer.from([0xe8, 0x01, 0x02, 0x03, 0x04, 0xe9, 0x05, 0x06, 0x07, 0x08]);
      const wc = detectRelativeDisplacements(bytes);
      expect(wc).toHaveLength(2);
      expect(wc[0]!.offset).toBe(1);
      expect(wc[1]!.offset).toBe(6);
    });
  });

  describe('generateSignature', () => {
    it('generates signature with wildcards', () => {
      // CALL + NOP: E8 01 02 03 04 90 90
      const bytes = Buffer.from([0xe8, 0x01, 0x02, 0x03, 0x04, 0x90, 0x90]);
      const result = generateSignature(bytes);
      expect(result.pattern).toBe('E8 ?? ?? ?? ?? 90 90');
      expect(result.wildcardCount).toBe(4);
      expect(result.size).toBe(7);
      expect(result.originalBytes).toBe('E8 01 02 03 04 90 90');
    });

    it('generates signature without wildcards for static code', () => {
      // PUSH RBP; MOV RBP, RSP: 55 48 89 E5
      const bytes = Buffer.from([0x55, 0x48, 0x89, 0xe5]);
      const result = generateSignature(bytes);
      expect(result.pattern).toBe('55 48 89 E5');
      expect(result.wildcardCount).toBe(0);
      expect(result.wildcarded).toHaveLength(0);
    });

    it('reports wildcarded offsets', () => {
      const bytes = Buffer.from([0xe8, 0x00, 0x00, 0x00, 0x00]);
      const result = generateSignature(bytes);
      expect(result.wildcarded).toHaveLength(1);
      expect(result.wildcarded[0]!.offset).toBe(1);
      expect(result.wildcarded[0]!.reason).toContain('CALL');
    });

    it('handles JMP rel32 wildcarding', () => {
      const bytes = Buffer.from([0xe9, 0x00, 0x00, 0x00, 0x00]);
      const result = generateSignature(bytes);
      expect(result.pattern).toBe('E9 ?? ?? ?? ??');
    });

    it('handles Jcc rel32 wildcarding', () => {
      const bytes = Buffer.from([0x0f, 0x84, 0x00, 0x00, 0x00, 0x00]);
      const result = generateSignature(bytes);
      expect(result.pattern).toBe('0F 84 ?? ?? ?? ??');
    });

    it('handles LEA RIP-relative wildcarding', () => {
      const bytes = Buffer.from([0x48, 0x8d, 0x0d, 0x00, 0x00, 0x00, 0x00]);
      const result = generateSignature(bytes);
      expect(result.pattern).toBe('48 8D 0D ?? ?? ?? ??');
    });

    it('handles mixed static + relative', () => {
      // 55 48 89 E5 E8 xx xx xx xx 48 83 C4 20
      const bytes = Buffer.from([
        0x55, 0x48, 0x89, 0xe5, 0xe8, 0x11, 0x22, 0x33, 0x44, 0x48, 0x83, 0xc4, 0x20,
      ]);
      const result = generateSignature(bytes);
      expect(result.pattern).toBe('55 48 89 E5 E8 ?? ?? ?? ?? 48 83 C4 20');
      expect(result.wildcardCount).toBe(4);
    });

    it('handles empty buffer', () => {
      const bytes = Buffer.alloc(0);
      const result = generateSignature(bytes);
      expect(result.pattern).toBe('');
      expect(result.size).toBe(0);
    });
  });
});
