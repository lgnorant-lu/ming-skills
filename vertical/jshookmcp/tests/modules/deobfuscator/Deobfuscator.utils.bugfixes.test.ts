import { describe, expect, it } from 'vitest';
import {
  detectObfuscationType,
  calculateReadabilityScore,
} from '@modules/deobfuscator/Deobfuscator.utils';

describe('Deobfuscator.utils bug fixes', () => {
  it('detectObfuscationType tolerates null/undefined code', () => {
    expect(detectObfuscationType(null as unknown as string)).toEqual(['unknown']);
    expect(detectObfuscationType(undefined as unknown as string)).toEqual(['unknown']);
  });

  it('calculateReadabilityScore tolerates null/undefined code', () => {
    expect(calculateReadabilityScore(null as unknown as string)).toBeGreaterThanOrEqual(0);
    expect(calculateReadabilityScore(undefined as unknown as string)).toBeGreaterThanOrEqual(0);
    expect(calculateReadabilityScore('')).toBeGreaterThanOrEqual(0);
  });

  it('still detects obfuscation for real input', () => {
    expect(detectObfuscationType('var _0x123 = [1,2];')).toContain('javascript-obfuscator');
  });
});
