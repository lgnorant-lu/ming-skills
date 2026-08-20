import { describe, expect, it } from 'vitest';
import { encodePerfettoTrace } from '@modules/trace/PerfettoEncoder';

describe('PerfettoEncoder bug fixes', () => {
  it('encodes pid/tid as varints (wire type 0), not fixed32', () => {
    const trace = encodePerfettoTrace(
      [{ tid: 42, pid: 7, name: 'main', uuid: 1 }],
      [{ name: 's', category: 'c', timestampUs: 1, durationUs: 1, tid: 42, pid: 7 }],
      [],
    );
    const bytes = Array.from(trace);

    // Field 1 (pid) as fixed32 would carry tag 0x0d; as varint it is 0x08.
    // Field 2 (tid) as fixed32 would carry tag 0x15; as varint it is 0x10.
    expect(bytes).toContain(0x08);
    expect(bytes).toContain(0x10);
    expect(bytes).not.toContain(0x0d);
    expect(bytes).not.toContain(0x15);
  });

  it('emits counter_value (field 30, fixed64) for counter events', () => {
    const trace = encodePerfettoTrace(
      [{ tid: 1, pid: 1, name: 'main', uuid: 1 }],
      [],
      [{ name: 'mem', category: 'c', timestampUs: 100, value: 12.5, tid: 1, pid: 1 }],
    );
    const bytes = Array.from(trace);

    // Tag for field 30, wire type 1 (fixed64): (30 << 3) | 1 = 0xf1.
    expect(bytes).toContain(0xf1);
  });

  it('counter_value bytes are non-zero for a non-zero value', () => {
    const trace = encodePerfettoTrace(
      [{ tid: 1, pid: 1, name: 'main', uuid: 1 }],
      [],
      [{ name: 'mem', category: 'c', timestampUs: 100, value: 42, tid: 1, pid: 1 }],
    );
    const bytes = Array.from(trace);
    const tagIndex = bytes.indexOf(0xf1);
    expect(tagIndex).toBeGreaterThanOrEqual(0);
    const valueBytes = bytes.slice(tagIndex + 1, tagIndex + 9);
    expect(valueBytes.some((b) => b !== 0)).toBe(true);
  });
});
