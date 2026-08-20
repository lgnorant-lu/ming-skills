import { describe, expect, it } from 'vitest';

import { readGuestCString } from '@modules/native-emulator/c-strings';

const encoder = new TextEncoder();

describe('guest C-string helpers', () => {
  it('reads long C strings with bounded host memory reads', () => {
    const text = 'x'.repeat(3072);
    const bytes = encoder.encode(`${text}\0`);
    const base = 16;
    const mem = new Uint8Array(base + bytes.length + 16);
    mem.set(bytes, base);
    let reads = 0;

    const value = readGuestCString(
      {
        read: (addr, len) => {
          reads++;
          return mem.subarray(addr, addr + len);
        },
      },
      base,
      4096,
    );

    expect(value).toBe(text);
    expect(reads).toBeLessThan(20);
  });
});
