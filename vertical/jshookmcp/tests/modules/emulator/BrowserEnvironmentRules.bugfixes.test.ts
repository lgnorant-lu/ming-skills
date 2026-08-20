import { describe, expect, it } from 'vitest';
import { BrowserEnvironmentRulesManager } from '@modules/emulator/BrowserEnvironmentRules';

describe('BrowserEnvironmentRules bug fixes', () => {
  it('crypto.getRandomValues fills the array with random bytes', () => {
    const manager = new BrowserEnvironmentRulesManager();
    const rule = manager.getRule('crypto.getRandomValues');
    const fn = rule?.defaultValue as ((array: unknown) => unknown) | undefined;

    expect(typeof fn).toBe('function');

    const array = new Uint8Array(32); // all zeros
    fn?.(array);

    // The array must no longer be all zeros — a pass-through implementation
    // would leave it untouched.
    expect(array.some((byte) => byte !== 0)).toBe(true);
    for (const byte of array) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }
  });

  it('getRandomValues fills typed arrays of other types too', () => {
    const manager = new BrowserEnvironmentRulesManager();
    const rule = manager.getRule('crypto.getRandomValues');
    const fn = rule?.defaultValue as ((array: unknown) => unknown) | undefined;

    const array = new Uint16Array(16);
    fn?.(array);

    expect(array.some((value) => value !== 0)).toBe(true);
  });

  it('location.protocol defaults to a protocol string, not a URL', () => {
    const manager = new BrowserEnvironmentRulesManager();
    expect(manager.getRule('location.protocol')?.defaultValue).toBe('https:');
  });
});
