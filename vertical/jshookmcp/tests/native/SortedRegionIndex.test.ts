/**
 * SortedRegionIndex unit tests.
 *
 * Tests binary search lookup, sorted ordering, readable-region filter,
 * LRU chunk cache, and cache eviction.
 */

import { describe, it, expect, vi } from 'vitest';
import { SortedRegionIndex } from '@native/SortedRegionIndex';
import type { MemoryRegionInfo } from '@native/platform/types';
import { MemoryProtection } from '@native/platform/types';

// ── Helpers ──

function makeRegion(overrides?: Partial<MemoryRegionInfo>): MemoryRegionInfo {
  return {
    baseAddress: 0x1000n,
    size: 4096,
    protection: MemoryProtection.ReadWrite,
    state: 'committed',
    type: 'private',
    isReadable: true,
    isWritable: true,
    isExecutable: false,
    ...overrides,
  };
}

function makeMockProvider(responses: Map<bigint, Buffer>): { provider: any; handle: any } {
  const handle = { pid: 9999, writeAccess: false };
  const provider = {
    readMemory: vi.fn((_h: any, addr: bigint, size: number) => {
      const buf = responses.get(addr);
      if (buf) return { data: Buffer.from(buf.subarray(0, size)), bytesRead: size };
      throw new Error(`No mock data at ${addr.toString(16)}`);
    }),
  };
  return { provider, handle };
}

// ── Tests ──

describe('SortedRegionIndex', () => {
  describe('build and size', () => {
    it('should be empty before build', () => {
      const idx = new SortedRegionIndex();
      expect(idx.size).toBe(0);
    });

    it('should index regions and report size', () => {
      const idx = new SortedRegionIndex();
      idx.build([
        makeRegion({ baseAddress: 0x2000n, size: 4096 }),
        makeRegion({ baseAddress: 0x1000n, size: 4096 }),
      ]);
      expect(idx.size).toBe(2);
    });

    it('should sort regions by base address ascending', () => {
      const idx = new SortedRegionIndex();
      idx.build([
        makeRegion({ baseAddress: 0x5000n, size: 4096 }),
        makeRegion({ baseAddress: 0x1000n, size: 4096 }),
        makeRegion({ baseAddress: 0x3000n, size: 4096 }),
      ]);
      const readable = idx.getReadableRegions();
      expect(readable[0]!.baseAddress).toBe(0x1000n);
      expect(readable[1]!.baseAddress).toBe(0x3000n);
      expect(readable[2]!.baseAddress).toBe(0x5000n);
    });

    it('should replace index on subsequent build calls', () => {
      const idx = new SortedRegionIndex();
      idx.build([makeRegion({ baseAddress: 0x1000n, size: 4096 })]);
      expect(idx.size).toBe(1);
      idx.build([makeRegion({ baseAddress: 0x2000n, size: 8192 })]);
      expect(idx.size).toBe(1);
      const r = idx.findRegion(0x2000n);
      expect(r).not.toBeNull();
      expect(r!.size).toBe(8192);
    });
  });

  describe('findRegion (binary search)', () => {
    it('should find a region by exact base address', () => {
      const idx = new SortedRegionIndex();
      idx.build([
        makeRegion({ baseAddress: 0x1000n, size: 4096 }),
        makeRegion({ baseAddress: 0x5000n, size: 4096 }),
      ]);
      const r = idx.findRegion(0x5000n);
      expect(r).not.toBeNull();
      expect(r!.baseAddress).toBe(0x5000n);
    });

    it('should find a region by interior address', () => {
      const idx = new SortedRegionIndex();
      idx.build([makeRegion({ baseAddress: 0x1000n, size: 4096 })]);
      const r = idx.findRegion(0x1800n);
      expect(r).not.toBeNull();
      expect(r!.baseAddress).toBe(0x1000n);
    });

    it('should find the last byte of a region', () => {
      const idx = new SortedRegionIndex();
      idx.build([makeRegion({ baseAddress: 0x1000n, size: 4096 })]);
      const r = idx.findRegion(0x1fffn);
      expect(r).not.toBeNull();
      expect(r!.baseAddress).toBe(0x1000n);
    });

    it('should return null for address before first region', () => {
      const idx = new SortedRegionIndex();
      idx.build([makeRegion({ baseAddress: 0x1000n, size: 4096 })]);
      expect(idx.findRegion(0x0n)).toBeNull();
    });

    it('should return null for address in gap between regions', () => {
      const idx = new SortedRegionIndex();
      idx.build([
        makeRegion({ baseAddress: 0x1000n, size: 4096 }),
        makeRegion({ baseAddress: 0x5000n, size: 4096 }),
      ]);
      expect(idx.findRegion(0x3000n)).toBeNull();
    });

    it('should return null for address past last region', () => {
      const idx = new SortedRegionIndex();
      idx.build([makeRegion({ baseAddress: 0x1000n, size: 4096 })]);
      expect(idx.findRegion(0x10000n)).toBeNull();
    });

    it('should handle single-region index', () => {
      const idx = new SortedRegionIndex();
      idx.build([makeRegion({ baseAddress: 0x1000n, size: 4096 })]);
      expect(idx.findRegion(0x1000n)!.baseAddress).toBe(0x1000n);
      expect(idx.findRegion(0x2000n)).toBeNull();
    });

    it('should handle many regions efficiently', () => {
      const idx = new SortedRegionIndex();
      const regions: MemoryRegionInfo[] = [];
      for (let i = 1; i <= 1000; i++) {
        regions.push(makeRegion({ baseAddress: BigInt(i * 0x10000), size: 4096 }));
      }
      idx.build(regions);
      // Binary search should find region 500
      expect(idx.findRegion(BigInt(500 * 0x10000))!.baseAddress).toBe(BigInt(500 * 0x10000));
      // Gap between regions
      expect(idx.findRegion(BigInt(500 * 0x10000) + 0x2000n)).toBeNull();
      // Before first
      expect(idx.findRegion(0n)).toBeNull();
      // After last
      expect(idx.findRegion(BigInt(1001 * 0x10000))).toBeNull();
    });
  });

  describe('getReadableRegions', () => {
    it('should return only readable regions', () => {
      const idx = new SortedRegionIndex();
      idx.build([
        makeRegion({ baseAddress: 0x1000n, size: 4096, isReadable: true }),
        makeRegion({ baseAddress: 0x2000n, size: 4096, isReadable: false }),
        makeRegion({ baseAddress: 0x3000n, size: 4096, isReadable: true }),
      ]);
      const readable = idx.getReadableRegions();
      expect(readable).toHaveLength(2);
      expect(readable[0]!.baseAddress).toBe(0x1000n);
      expect(readable[1]!.baseAddress).toBe(0x3000n);
    });

    it('should return empty array when no regions are readable', () => {
      const idx = new SortedRegionIndex();
      idx.build([makeRegion({ baseAddress: 0x1000n, size: 4096, isReadable: false })]);
      expect(idx.getReadableRegions()).toHaveLength(0);
    });

    it('should be sorted by base address', () => {
      const idx = new SortedRegionIndex();
      idx.build([
        makeRegion({ baseAddress: 0x5000n, size: 4096, isReadable: true }),
        makeRegion({ baseAddress: 0x1000n, size: 4096, isReadable: true }),
        makeRegion({ baseAddress: 0x3000n, size: 4096, isReadable: false }),
      ]);
      const readable = idx.getReadableRegions();
      expect(readable[0]!.baseAddress).toBe(0x1000n);
      expect(readable[1]!.baseAddress).toBe(0x5000n);
    });
  });

  describe('chunk cache', () => {
    it('should return cached data on repeated reads', async () => {
      const data = Buffer.alloc(64, 0xab);
      const { provider, handle } = makeMockProvider(new Map([[0x1000n, data]]));
      const idx = new SortedRegionIndex();
      idx.build([makeRegion({ baseAddress: 0x1000n, size: 64 })]);

      // First read calls provider
      const r1 = await idx.readChunk(provider, handle, 0x1000n, 64);
      expect(r1[0]).toBe(0xab);
      expect(provider.readMemory).toHaveBeenCalledTimes(1);

      // Second read hits cache
      const r2 = await idx.readChunk(provider, handle, 0x1000n, 32);
      expect(r2[0]).toBe(0xab);
      expect(r2.length).toBe(32);
      expect(provider.readMemory).toHaveBeenCalledTimes(1); // No additional call
    });

    it('should call provider on cache miss (different address)', async () => {
      const data1 = Buffer.alloc(64, 0xab);
      const data2 = Buffer.alloc(64, 0xcd);
      const { provider, handle } = makeMockProvider(
        new Map([
          [0x1000n, data1],
          [0x2000n, data2],
        ]),
      );
      const idx = new SortedRegionIndex();

      await idx.readChunk(provider, handle, 0x1000n, 64);
      expect(provider.readMemory).toHaveBeenCalledTimes(1);

      await idx.readChunk(provider, handle, 0x2000n, 64);
      expect(provider.readMemory).toHaveBeenCalledTimes(2);
    });

    it('should evict LRU entry when cache is full', async () => {
      const { provider, handle } = makeMockProvider(
        new Map([
          [0x1000n, Buffer.alloc(64, 0x11)],
          [0x2000n, Buffer.alloc(64, 0x22)],
          [0x3000n, Buffer.alloc(64, 0x33)],
          [0x4000n, Buffer.alloc(64, 0x44)],
        ]),
      );
      // cache size = 3
      const idx = new SortedRegionIndex(3);

      // Fill cache: 0x1000, 0x2000, 0x3000
      await idx.readChunk(provider, handle, 0x1000n, 64);
      await idx.readChunk(provider, handle, 0x2000n, 64);
      await idx.readChunk(provider, handle, 0x3000n, 64);
      expect(idx.cacheSize).toBe(3);

      // Read 0x4000 — evicts 0x1000 (LRU), cache stays at 3
      await idx.readChunk(provider, handle, 0x4000n, 64);
      expect(idx.cacheSize).toBe(3);
      // 0x4000 was fetched via provider
      expect(provider.readMemory).toHaveBeenCalledTimes(4);

      // 0x1000 should now be a miss (was evicted)
      const callCountBefore = (provider.readMemory as ReturnType<typeof vi.fn>).mock.calls.length;
      await idx.readChunk(provider, handle, 0x1000n, 64);
      expect((provider.readMemory as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        callCountBefore + 1,
      ); // re-fetched
    });

    it('should promote recently accessed entries (LRU)', async () => {
      const { provider, handle } = makeMockProvider(
        new Map([
          [0x1000n, Buffer.alloc(64, 0x11)],
          [0x2000n, Buffer.alloc(64, 0x22)],
          [0x3000n, Buffer.alloc(64, 0x33)],
          [0x4000n, Buffer.alloc(64, 0x44)],
        ]),
      );
      const idx = new SortedRegionIndex(3);

      // Fill: 0x1000, 0x2000, 0x3000 (0x1000 is LRU)
      await idx.readChunk(provider, handle, 0x1000n, 64);
      await idx.readChunk(provider, handle, 0x2000n, 64);
      await idx.readChunk(provider, handle, 0x3000n, 64);

      // Access 0x1000 again — promotes it to MRU, 0x2000 becomes LRU
      await idx.readChunk(provider, handle, 0x1000n, 64);

      // Add 0x4000 — evicts 0x2000 (now LRU), not 0x1000
      await idx.readChunk(provider, handle, 0x4000n, 64);
      expect(idx.cacheSize).toBe(3);

      // 0x1000 should be a cache hit (was promoted)
      const callCount = (provider.readMemory as ReturnType<typeof vi.fn>).mock.calls.length;
      await idx.readChunk(provider, handle, 0x1000n, 64);
      expect((provider.readMemory as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount); // No additional call — cache hit
    });

    it('should re-fetch when cached chunk is smaller than requested', async () => {
      const handle = { pid: 9999, writeAccess: false };
      // Create a mock provider that returns data sized to the request,
      // with a sequence number marker at offset 0 to distinguish calls.
      const provider = {
        readMemory: vi.fn((_h: any, _addr: bigint, _size: number) => {
          const buf = Buffer.alloc(_size, 0xcc);
          buf[0] = provider.readMemory.mock.calls.length;
          return { data: buf, bytesRead: _size };
        }),
      };
      const idx = new SortedRegionIndex(8);

      // First read: 32 bytes
      const r1 = await idx.readChunk(provider as any, handle, 0x1000n, 32);
      expect(r1.length).toBe(32);
      expect(provider.readMemory).toHaveBeenCalledTimes(1);

      // Second read: 64 bytes on same address but larger → cache miss
      const r2 = await idx.readChunk(provider as any, handle, 0x1000n, 64);
      expect(r2.length).toBe(64);
      expect(provider.readMemory).toHaveBeenCalledTimes(2);

      // Third read: 32 bytes on same address → cache hit (64 ≥ 32)
      const r3 = await idx.readChunk(provider as any, handle, 0x1000n, 32);
      expect(r3.length).toBe(32);
      expect(provider.readMemory).toHaveBeenCalledTimes(2); // Hit
    });

    it('should clear cache without affecting regions', async () => {
      const data = Buffer.alloc(64, 0xff);
      const { provider, handle } = makeMockProvider(new Map([[0x1000n, data]]));
      const idx = new SortedRegionIndex();
      idx.build([makeRegion({ baseAddress: 0x1000n, size: 64 })]);

      await idx.readChunk(provider, handle, 0x1000n, 64);
      expect(idx.cacheSize).toBe(1);

      idx.clearCache();
      expect(idx.cacheSize).toBe(0);
      expect(idx.size).toBe(1); // Regions unaffected

      // Subsequent read is a miss
      await idx.readChunk(provider, handle, 0x1000n, 64);
      expect(provider.readMemory).toHaveBeenCalledTimes(2);
    });
  });
});
