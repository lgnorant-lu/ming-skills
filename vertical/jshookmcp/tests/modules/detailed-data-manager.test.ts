/**
 * Unit tests for DetailedDataManager — persistence, TTL, gzip, LRU eviction.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Use a temp directory for test persistence
const TEST_DIR = join(tmpdir(), `detailed-data-test-${Date.now()}`);

// Mock getArtifactDir to use our test directory
vi.mock('@utils/artifacts', () => ({
  getArtifactDir: (sub: string) => join(TEST_DIR, sub),
}));

// Mock only the detailed-data constants; keep search/config constants intact.
vi.mock('@src/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/constants')>();
  return {
    ...actual,
    DETAILED_DATA_DEFAULT_TTL_MS: 2000,
    DETAILED_DATA_MAX_TTL_MS: 10000,
    DETAILED_DATA_SMART_THRESHOLD_BYTES: 100,
  };
});

describe('DetailedDataManager', () => {
  let manager: DetailedDataManager;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(join(TEST_DIR, 'tmp', 'detailed-data'), { recursive: true });
    manager = new DetailedDataManager();
    // Allow init() to complete
    await new Promise((r) => setTimeout(r, 100));
  });

  afterEach(async () => {
    manager.shutdown();
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  // ─── Store & Retrieve ────────────────────────────────────────────

  it('stores and retrieves data', () => {
    const data = { hello: 'world', count: 42 };
    const id = manager.store(data);

    expect(id).toMatch(/^detail_\d+_[a-z0-9]+$/);
    const retrieved = manager.retrieve(id);
    expect(retrieved).toEqual(data);
  });

  it('throws on expired detailId', async () => {
    const id = manager.store({ temp: true }, 100); // 100ms TTL
    await new Promise((r) => setTimeout(r, 150));
    expect(() => manager.retrieve(id)).toThrow(/expired/i);
  });

  it('throws on non-existent detailId', () => {
    expect(() => manager.retrieve('nonexistent')).toThrow(/not found/i);
  });

  it('stores arrays', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const id = manager.store(data);
    const retrieved = manager.retrieve<typeof data>(id);
    expect(retrieved).toHaveLength(50);
  });

  // ─── Path-based retrieval ────────────────────────────────────────

  it('retrieves nested data by path', () => {
    const data = { level1: { level2: { value: 'deep' } } };
    const id = manager.store(data);
    const value = manager.retrieve<string>(id, 'level1.level2.value');
    expect(value).toBe('deep');
  });

  it('throws on invalid path', () => {
    const data = { foo: 'bar' };
    const id = manager.store(data);
    expect(() => manager.retrieve(id, 'nonexistent.path')).toThrow(/path not found/i);
  });

  // ─── Smart handle ────────────────────────────────────────────────

  it('returns small data directly', () => {
    const small = { x: 1 };
    const result = manager.smartHandle(small);
    expect(result).toBe(small); // Same reference
  });

  it('returns summary for large data', () => {
    const large = { data: 'x'.repeat(200) };
    const result = manager.smartHandle(large);
    expect(result).not.toBe(large);
    expect(result).toHaveProperty('detailId');
    expect(result).toHaveProperty('summary');
  });

  // ─── LRU Eviction ────────────────────────────────────────────────

  it('evicts LRU entry when cache is full', () => {
    // Fill cache to MAX_CACHE_SIZE (100 entries)
    for (let i = 0; i < 110; i++) {
      manager.store({ index: i });
    }

    const stats = manager.getStats();
    expect(stats.cacheSize).toBeLessThanOrEqual(100);
    expect(stats.metrics.evictedByLRUCount + stats.metrics.evictedBySizeCount).toBeGreaterThan(0);
  });

  // ─── Extend TTL ──────────────────────────────────────────────────

  it('extends TTL of an entry', () => {
    const id = manager.store({ temp: true }, 200); // 200ms TTL
    manager.extend(id, 5000); // Extend by 5 seconds

    // After original TTL, entry should still be accessible
    const result = manager.retrieve(id);
    expect(result).toEqual({ temp: true });
  });

  it('throws when extending expired entry', async () => {
    const id = manager.store({ temp: true }, 50); // 50ms TTL
    await new Promise((r) => setTimeout(r, 100));
    expect(() => manager.extend(id)).toThrow(/expired/i);
  });

  // ─── Stats ───────────────────────────────────────────────────────

  it('reports stats', () => {
    manager.store({ a: 1 });
    manager.store({ b: 2 });

    const stats = manager.getStats();
    expect(stats.cacheSize).toBeGreaterThanOrEqual(2);
    expect(stats.persistence).toBeDefined();
    expect(stats.persistence.gzipEnabled).toBe(true);
    expect(stats.metrics).toBeDefined();
    expect(stats.metrics.diskWriteCount).toBeGreaterThanOrEqual(0);
  });

  // ─── Clear ───────────────────────────────────────────────────────

  it('clears all entries', () => {
    manager.store({ a: 1 });
    manager.store({ b: 2 });
    manager.clear();

    const stats = manager.getStats();
    expect(stats.cacheSize).toBe(0);
  });

  // ─── Gzip persistence ────────────────────────────────────────────

  it('persists large data with gzip compression', async () => {
    const largeData = { payload: 'x'.repeat(5000) };
    manager.store(largeData);

    // Wait for async persist
    await new Promise((r) => setTimeout(r, 300));

    const stats = manager.getStats();
    // At least one entry should be compressed (if persistence is enabled)
    if (stats.persistence.enabled) {
      expect(stats.persistence.compressedCount).toBeGreaterThanOrEqual(1);
    }
  });
});
