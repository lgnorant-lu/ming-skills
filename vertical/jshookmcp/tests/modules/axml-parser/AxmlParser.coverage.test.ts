/**
 * Coverage tests for AxmlParser.parseAxml — exercises the try/catch wrapper:
 * invalid / truncated buffers yield null; the full parse path needs a real
 * Android binary XML fixture (not constructed here).
 */

import { describe, expect, it } from 'vitest';
import { parseAxml } from '@modules/axml-parser/AxmlParser';

describe('parseAxml — error-path wrapper', () => {
  it('returns null for an empty buffer (parse throws)', () => {
    expect(parseAxml(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a too-small buffer', () => {
    expect(parseAxml(Buffer.from([0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });

  it('returns null for a buffer with bad magic', () => {
    expect(parseAxml(Buffer.from('not-axml-binary-data!!', 'utf8'))).toBeNull();
  });

  it('returns null for random bytes', () => {
    expect(parseAxml(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xde, 0xad, 0xbe, 0xef]))).toBeNull();
  });
});
