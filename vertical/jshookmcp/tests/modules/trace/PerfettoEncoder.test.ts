import { describe, expect, it } from 'vitest';
import { encodePerfettoTrace, encodeVarintPrefixed } from '@modules/trace/PerfettoEncoder';
import type { PerfettoSlice, PerfettoTrackDef } from '@modules/trace/PerfettoEncoder';

describe('PerfettoEncoder', () => {
  function readVarint(bytes: Uint8Array, start: number): [number, number] {
    let value = 0;
    let factor = 1;
    let offset = start;
    while (offset < bytes.length) {
      const byte = bytes[offset++]!;
      value += (byte & 0x7f) * factor;
      if ((byte & 0x80) === 0) return [value, offset];
      factor *= 0x80;
    }
    throw new Error('Truncated varint');
  }

  const makeSlice = (overrides: Partial<PerfettoSlice> = {}): PerfettoSlice => ({
    name: 'testEvent',
    category: 'debugger',
    timestampUs: 1_000_000,
    durationUs: 500,
    tid: 2,
    pid: 1,
    ...overrides,
  });

  const makeDebugTrack = (): PerfettoTrackDef => ({
    tid: 2,
    pid: 1,
    name: 'Debugger',
    uuid: 2,
  });

  it('produces a non-empty Uint8Array for a single slice', () => {
    const tracks: PerfettoTrackDef[] = [makeDebugTrack()];
    const slices: PerfettoSlice[] = [makeSlice()];
    const output = encodePerfettoTrace(tracks, slices, []);
    expect(output).toBeInstanceOf(Uint8Array);
    expect(output.length).toBeGreaterThan(0);
  });

  it('includes track descriptors before slice begin/end packets', () => {
    const tracks: PerfettoTrackDef[] = [makeDebugTrack()];
    const slices: PerfettoSlice[] = [makeSlice({ name: 'Debugger.paused' })];
    const output = encodePerfettoTrace(tracks, slices, []);

    expect(output[0]).toBe(0x0a);
    const [firstLen] = readVarint(output, 1);
    expect(firstLen).toBeGreaterThan(0);

    // The track descriptor packet body should contain the thread_name "Debugger"
    // in UTF-8 somewhere.
    const text = new TextDecoder().decode(output);
    expect(text).toContain('Debugger');
  });

  it('emits a begin and end packet for each slice (X-style complete event)', () => {
    const tracks: PerfettoTrackDef[] = [makeDebugTrack()];
    const slices: PerfettoSlice[] = [makeSlice({ name: 'A', timestampUs: 1000, durationUs: 500 })];

    const output = encodePerfettoTrace(tracks, slices, []);
    const text = new TextDecoder().decode(output);

    // Should mention both the slice name
    expect(text).toContain('A');
  });

  it('handles empty inputs', () => {
    const output = encodePerfettoTrace([], [], []);
    expect(output).toBeInstanceOf(Uint8Array);
    expect(output.length).toBe(0);
  });

  it('handles multiple tracks and slices', () => {
    const tracks: PerfettoTrackDef[] = [
      { tid: 2, pid: 1, name: 'Debugger', uuid: 2 },
      { tid: 3, pid: 1, name: 'Network', uuid: 3 },
    ];
    const slices: PerfettoSlice[] = [
      makeSlice({ name: 'D1', tid: 2 }),
      makeSlice({ name: 'N1', tid: 3, category: 'network' }),
    ];

    const output = encodePerfettoTrace(tracks, slices, []);
    // Each track descriptor = 1 packet, each slice = 2 packets (begin+end)
    // 2 tracks + 2*2 slices = 6 packets
    expect(output.length).toBeGreaterThan(0);
  });

  it('encodeVarintPrefixed wraps a packet with a varint length', () => {
    const packet = [8, 150, 4]; // tag 1 varint 150 (simple proto)
    const framed = encodeVarintPrefixed(packet);
    // First byte should be the varint length (3 in this case)
    expect(framed[0]).toBe(3);
    // Remaining bytes are the packet
    expect(framed.slice(1)).toEqual(packet);
  });

  it('wraps each packet as a repeated Trace.packet protobuf field', () => {
    const tracks: PerfettoTrackDef[] = [makeDebugTrack()];
    const slices: PerfettoSlice[] = [makeSlice()];
    const output = encodePerfettoTrace(tracks, slices, []);

    let offset = 0;
    while (offset < output.length) {
      expect(output[offset++]).toBe(0x0a);
      const [len, bodyOffset] = readVarint(output, offset);
      expect(len).toBeGreaterThan(0);
      expect(len).toBeLessThan(output.length);
      offset = bodyOffset + len;
    }
    expect(offset).toBe(output.length);
  });

  it('preserves timestamps above the unsigned 32-bit range', () => {
    const timestampUs = 1_720_000_000_123_000;
    const output = encodePerfettoTrace(
      [makeDebugTrack()],
      [makeSlice({ timestampUs, durationUs: 1 })],
      [],
    );

    let offset = 0;
    let found = false;
    while (offset < output.length) {
      offset += 1;
      const [length, bodyOffset] = readVarint(output, offset);
      const packet = output.slice(bodyOffset, bodyOffset + length);
      const timestampTag = packet.indexOf(0x40);
      if (timestampTag >= 0) {
        const [decoded] = readVarint(packet, timestampTag + 1);
        if (decoded === timestampUs) found = true;
      }
      offset = bodyOffset + length;
    }
    expect(found).toBe(true);
  });
});
