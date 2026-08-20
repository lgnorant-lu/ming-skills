/**
 * Regression tests: handlePcapRead auto-detects PCAPNG files (magic
 * 0x0a0d0d0a) and must map PcapngPacketSummary → PcapPacketSummary fields.
 *
 * Bug: the pcapng summaries were cast (`as unknown as PcapPacketSummary[]`),
 * but the two shapes have completely different field names — consumers of
 * handlePcapRead read `timestampSeconds`/`timestampFraction`/`includedLength`
 * and got `undefined` for every field (pcapng emits `kind`,
 * `timestampHigh`/`timestampLow`, `capturedLength`, ...).
 */

import { mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';
import type { PcapngWriteInput } from '@server/domains/protocol-analysis/handlers/shared/network-packet/pcapng';
import { buildPcapng } from '@server/domains/protocol-analysis/handlers/shared/network-packet/pcapng-writer';

describe('handlePcapRead — PCAPNG auto-detect field mapping', () => {
  let handlers: ProtocolAnalysisHandlers;
  const eventBus = { emit: vi.fn() } as never;
  const tempDirs: string[] = [];

  beforeEach(() => {
    handlers = new ProtocolAnalysisHandlers(undefined, undefined, eventBus);
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function writePcapng(name: string, input: PcapngWriteInput): Promise<string> {
    const buffer = buildPcapng(input);
    const dir = await mkdtemp(join(tmpdir(), 'pcap-read-mapping-'));
    tempDirs.push(dir);
    const path = join(dir, name);
    await fsWriteFile(path, buffer);
    return path;
  }

  it('maps pcapng packets to PcapPacketSummary fields (no undefineds)', async () => {
    const path = await writePcapng('minimal.pcapng', {
      endianness: 'little',
      interfaces: [{ linkType: 1, snapLen: 65535 }],
      // timestampLow=100 → 100 microseconds: seconds=0, fraction=100
      packets: [{ dataHex: 'aabbccdd', timestampHigh: 0, timestampLow: 100 }],
    });

    const result = await handlers.handlePcapRead({ path });

    expect(result.success).toBe(true);
    expect(result.format).toBe('pcapng');
    expect(result.packets).toHaveLength(1);

    const packet = result.packets[0]!;
    // The classic-PCAP field contract the handler promises:
    expect(packet.timestampSeconds).toBe(0);
    expect(packet.timestampFraction).toBe(100);
    expect(packet.includedLength).toBe(4);
    expect(packet.originalLength).toBe(4);
    expect(packet.dataHex).toBe('aabbccdd');
    expect(packet.truncated).toBe(false);
    expect(packet.index).toBe(0);

    // No pcapng-only fields may leak through the mapping.
    expect('kind' in packet).toBe(false);
    expect('timestampHigh' in packet).toBe(false);
    expect('timestampLow' in packet).toBe(false);
    expect('capturedLength' in packet).toBe(false);
    expect('blockIndex' in packet).toBe(false);
  });

  it('splits a >1s timestamp into seconds + microsecond fraction', async () => {
    const path = await writePcapng('ts.pcapng', {
      interfaces: [{ linkType: 1 }],
      // 1_500_000 microseconds = 1.5s
      packets: [{ dataHex: 'aa', timestampHigh: 0, timestampLow: 1_500_000 }],
    });

    const result = await handlers.handlePcapRead({ path });
    expect(result.packets[0]?.timestampSeconds).toBe(1);
    expect(result.packets[0]?.timestampFraction).toBe(500_000);
  });

  it('normalizes nanosecond-resolution timestamps to microseconds', async () => {
    const path = await writePcapng('nano.pcapng', {
      interfaces: [{ linkType: 1, tsresol: 9 }], // 10^9 = nanoseconds
      packets: [{ dataHex: 'aa', timestampHigh: 0, timestampLow: 1_500_000_000 }], // 1.5s
    });

    const result = await handlers.handlePcapRead({ path });
    expect(result.packets[0]?.timestampSeconds).toBe(1);
    expect(result.packets[0]?.timestampFraction).toBe(500_000);
  });

  it('respects per-interface tsresol (nano interface, micro default)', async () => {
    const path = await writePcapng('multi-ts.pcapng', {
      interfaces: [
        { linkType: 1 }, // tsresol unset → 10^6 (micro)
        { linkType: 1, tsresol: 9 }, // nano
      ],
      packets: [
        { dataHex: 'aa', interfaceId: 0, timestampLow: 2_000_000 }, // 2s micro
        { dataHex: 'bb', interfaceId: 1, timestampLow: 2_500_000_000 }, // 2.5s nano
      ],
    });

    const result = await handlers.handlePcapRead({ path });
    expect(result.packets[0]?.timestampSeconds).toBe(2);
    expect(result.packets[0]?.timestampFraction).toBe(0);
    expect(result.packets[1]?.timestampSeconds).toBe(2);
    expect(result.packets[1]?.timestampFraction).toBe(500_000);
  });

  it('maps multiple packets preserving order and data', async () => {
    const path = await writePcapng('multi.pcapng', {
      interfaces: [{ linkType: 1 }],
      packets: [
        { dataHex: '00112233', timestampHigh: 0, timestampLow: 1 },
        { dataHex: '44556677', timestampHigh: 0, timestampLow: 2 },
      ],
    });

    const result = await handlers.handlePcapRead({ path });
    expect(result.packets).toHaveLength(2);
    expect(result.packets.map((p) => p.dataHex)).toEqual(['00112233', '44556677']);
    expect(result.packets.map((p) => p.timestampFraction)).toEqual([1, 2]);
  });
});
