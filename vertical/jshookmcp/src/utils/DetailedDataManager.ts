import { logger } from '@utils/logger';
import { sanitizeForCache } from '@utils/sanitizeForCache';
import {
  DETAILED_DATA_DEFAULT_TTL_MS,
  DETAILED_DATA_MAX_TTL_MS,
  DETAILED_DATA_SMART_THRESHOLD_BYTES,
} from '@src/constants';
import { readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getArtifactDir } from '@utils/artifacts';
import { gzip, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

/** Whether to compress persisted entries with gzip (saves ~70-90% disk). */
const ENABLE_GZIP = true;
/** Compress entries larger than this many bytes. */
const GZIP_THRESHOLD_BYTES = 1024;

export interface DataSummary {
  type: string;
  size: number;
  sizeKB: string;
  preview: string;
  structure?: {
    keys?: string[];
    methods?: string[];
    properties?: string[];
    length?: number;
  };
}

export interface DetailedDataResponse {
  summary: DataSummary;
  detailId: string;
  hint: string;
  expiresAt: number;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  size: number;
  persistPath?: string; // Disk path for persisted entries
  compressed?: boolean; // Whether the persisted file is gzip-compressed
}

interface PersistedMetadata {
  detailId: string;
  expiresAt: number;
  createdAt: number;
  size: number;
  compressed?: boolean;
}

/** Monitoring counters emitted via getStats(). */
interface PersistenceMetrics {
  diskWriteCount: number;
  diskWriteFailCount: number;
  diskReadCount: number;
  diskReadFailCount: number;
  diskReadLazyCount: number;
  gzipCompressCount: number;
  gzipDecompressCount: number;
  evictedBySizeCount: number;
  evictedByLRUCount: number;
  totalBytesWritten: number;
  totalBytesRead: number;
}

export class DetailedDataManager {
  private static instance: DetailedDataManager | undefined;
  private cache = new Map<string, CacheEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private persistDir: string;
  private metadataPath: string;
  private persistenceEnabled = true;
  private disposed = false;

  private readonly DEFAULT_TTL = DETAILED_DATA_DEFAULT_TTL_MS;
  private readonly MAX_TTL = DETAILED_DATA_MAX_TTL_MS;
  private readonly MAX_CACHE_SIZE = 100;
  /** Soft limit on total in-memory data (bytes). Triggers LRU eviction when exceeded. */
  private readonly MAX_TOTAL_MEMORY_BYTES = 50 * 1024 * 1024; // 50 MB

  private readonly AUTO_EXTEND_ON_ACCESS = true;
  private readonly EXTEND_DURATION = 15 * 60 * 1000;

  /** Memo cache to avoid re-serializing the same object within a single call chain */
  private serializationMemo = new WeakMap<object, { json: string; size: number }>();

  /** Monitoring metrics for observability. */
  private metrics: PersistenceMetrics = {
    diskWriteCount: 0,
    diskWriteFailCount: 0,
    diskReadCount: 0,
    diskReadFailCount: 0,
    diskReadLazyCount: 0,
    gzipCompressCount: 0,
    gzipDecompressCount: 0,
    evictedBySizeCount: 0,
    evictedByLRUCount: 0,
    totalBytesWritten: 0,
    totalBytesRead: 0,
  };

  constructor() {
    this.persistDir = join(getArtifactDir('tmp'), 'detailed-data');
    this.metadataPath = join(this.persistDir, '.metadata.jsonl');
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (typeof this.cleanupInterval === 'object' && 'unref' in this.cleanupInterval) {
      this.cleanupInterval.unref();
    }
    void this.init();
  }

  /** @deprecated Use constructor injection. Kept for backward compatibility. */
  static getInstance(): DetailedDataManager {
    if (!this.instance) {
      this.instance = new DetailedDataManager();
    }
    return this.instance;
  }

  shutdown(): void {
    this.disposed = true;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    // Reset singleton so next getInstance() creates a fresh instance with interval
    DetailedDataManager.instance = undefined;
  }

  private async init(): Promise<void> {
    try {
      await fs.mkdir(this.persistDir, { recursive: true });
      if (this.disposed) return;
      await this.loadPersistedEntries();
      if (this.disposed) return;
      await this.cleanupExpired();
    } catch (error) {
      if (this.disposed) return;
      logger.warn('Failed to initialize persistence, falling back to memory-only', error);
      this.persistenceEnabled = false;
    }
  }

  private async loadPersistedEntries(): Promise<void> {
    try {
      const content = await fs.readFile(this.metadataPath, 'utf-8');
      if (this.disposed) return;
      const lines = content.trim().split('\n').filter(Boolean);
      const now = Date.now();

      for (const line of lines) {
        if (this.disposed) return;
        const meta: PersistedMetadata = JSON.parse(line);
        if (meta.expiresAt > now) {
          this.cache.set(meta.detailId, {
            data: null, // Lazy load on retrieve
            expiresAt: meta.expiresAt,
            createdAt: meta.createdAt,
            lastAccessedAt: now,
            accessCount: 0,
            size: meta.size,
            persistPath: join(
              this.persistDir,
              `${meta.detailId}${meta.compressed ? '.gz' : '.json'}`,
            ),
            compressed: meta.compressed,
          });
        }
      }
      if (!this.disposed) logger.info(`Loaded ${this.cache.size} persisted detail entries`);
    } catch (error) {
      if (!this.disposed && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to load persisted metadata', error);
      }
    }
  }

  private async cleanupExpired(): Promise<void> {
    if (this.disposed) return;
    if (!this.persistenceEnabled) return;

    const now = Date.now();
    const expired: string[] = [];

    for (const [detailId, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        expired.push(detailId);
        if (entry.persistPath) {
          await fs.unlink(entry.persistPath).catch(() => {});
          if (this.disposed) return;
        }
      }
    }

    if (expired.length > 0) {
      expired.forEach((id) => this.cache.delete(id));
      await this.rebuildMetadata();
      if (!this.disposed) logger.info(`Cleaned up ${expired.length} expired detail entries`);
    }
  }

  private async rebuildMetadata(): Promise<void> {
    if (this.disposed) return;
    if (!this.persistenceEnabled) return;

    const lines: string[] = [];
    for (const [detailId, entry] of this.cache.entries()) {
      if (entry.persistPath) {
        const meta: PersistedMetadata = {
          detailId,
          expiresAt: entry.expiresAt,
          createdAt: entry.createdAt,
          size: entry.size,
        };
        lines.push(JSON.stringify(meta));
      }
    }

    if (!this.disposed) {
      await fs.writeFile(this.metadataPath, lines.join('\n') + '\n').catch(() => {});
    }
  }

  /**
   * Serialize data with memoization to avoid redundant JSON.stringify calls.
   * Objects are cached in a WeakMap so the memo is automatically GC'd.
   */
  private serializeWithMemo(data: unknown): { json: string; size: number } {
    if (data !== null && typeof data === 'object') {
      const cached = this.serializationMemo.get(data);
      if (cached) return cached;
    }

    const json = JSON.stringify(data);
    const result = { json, size: json.length };

    if (data !== null && typeof data === 'object') {
      this.serializationMemo.set(data, result);
    }

    return result;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
  }

  private readPathSegment(value: unknown, key: string): unknown {
    return (Object(value) as Record<string, unknown>)[key];
  }

  smartHandle<T>(
    data: T,
    threshold = DETAILED_DATA_SMART_THRESHOLD_BYTES,
  ): T | DetailedDataResponse {
    // SECURITY: Check strings against threshold — they can be arbitrarily large.
    // Only skip serialization for true primitives (number, boolean, null, undefined).
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object' && typeof data !== 'string') return data;
    if (typeof data === 'string') {
      if (data.length <= threshold) return data;
      // Large string — fall through to store/summarize
    }

    const { json: jsonStr, size } = this.serializeWithMemo(data);

    if (size <= threshold) {
      return data;
    }

    logger.info(`Data too large (${(size / 1024).toFixed(1)}KB), returning summary with detailId`);
    return this.createDetailedResponseWithSize(data, jsonStr, size);
  }

  private createDetailedResponseWithSize(
    data: unknown,
    jsonStr: string,
    size: number,
  ): DetailedDataResponse {
    const detailId = this.storeWithSize(data, size);
    const summary = this.generateSummaryFromJson(data, jsonStr, size);

    return {
      summary,
      detailId,
      hint:
        `Data too large. Use get_detailed_data("${detailId}") to retrieve full data, or ` +
        `get_detailed_data("${detailId}` +
        `", path="key.subkey") for specific part.`,
      expiresAt: Date.now() + this.DEFAULT_TTL,
    };
  }

  store<T>(data: T, customTTL?: number): string {
    const { size } = this.serializeWithMemo(data);
    return this.storeWithSize(data, size, customTTL);
  }

  private storeWithSize(data: unknown, size: number, customTTL?: number): string {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictLRU();
    }

    // CONTEXT SAFETY (issue #62): strip oversized fields (data: URIs, huge strings)
    // to disk-backed placeholders BEFORE caching, so a later get_detailed_data
    // retrieval can never re-emit multi-MB blobs into the LLM context window.
    // sanitizeForCache returns the same reference when nothing needed offloading,
    // so the common path stays a cheap no-op with no size recomputation.
    const sanitized = sanitizeForCache(data);
    const effectiveSize = sanitized === data ? size : this.serializeWithMemo(sanitized).size;

    const detailId = `detail_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();
    const ttl = customTTL || this.DEFAULT_TTL;
    const expiresAt = now + ttl;

    const shouldCompress = ENABLE_GZIP && effectiveSize > GZIP_THRESHOLD_BYTES;
    const persistPath = this.persistenceEnabled
      ? join(this.persistDir, `${detailId}${shouldCompress ? '.gz' : '.json'}`)
      : undefined;

    const entry: CacheEntry = {
      data: sanitized,
      expiresAt,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      size: effectiveSize,
      persistPath,
      compressed: shouldCompress,
    };

    this.cache.set(detailId, entry);

    // Persist to disk asynchronously (with optional gzip compression)
    if (persistPath) {
      void this.persistToDisk(persistPath, sanitized, shouldCompress)
        .then((bytesWritten) => {
          this.metrics.diskWriteCount++;
          this.metrics.totalBytesWritten += bytesWritten;
          return this.appendMetadata({
            detailId,
            expiresAt,
            createdAt: now,
            size: effectiveSize,
            compressed: shouldCompress,
          });
        })
        .catch((err) => {
          this.metrics.diskWriteFailCount++;
          logger.warn(`Failed to persist ${detailId}`, err);
        });
    }

    logger.debug(
      `Stored detailed data: ${detailId}, size: ${(effectiveSize / 1024).toFixed(1)}KB, expires in ${ttl / 1000}s`,
    );

    return detailId;
  }

  private async appendMetadata(meta: PersistedMetadata): Promise<void> {
    try {
      await fs.appendFile(this.metadataPath, JSON.stringify(meta) + '\n');
    } catch (error) {
      logger.warn('Failed to append metadata', error);
    }
  }

  retrieve<T = unknown>(detailId: string, path?: string): T {
    const cached = this.cache.get(detailId);

    if (!cached) {
      throw new Error(`DetailId not found or expired: ${detailId}`);
    }

    const now = Date.now();

    if (now > cached.expiresAt) {
      this.cache.delete(detailId);
      if (cached.persistPath) {
        void fs.unlink(cached.persistPath).catch(() => {});
      }
      throw new Error(`DetailId expired: ${detailId}`);
    }

    // Lazy load from disk if data is null
    if (cached.data === null && cached.persistPath) {
      try {
        const raw = readFileSync(cached.persistPath);
        if (cached.compressed) {
          const decompressed = gunzipSync(raw);
          cached.data = JSON.parse(decompressed.toString('utf-8'));
          this.metrics.gzipDecompressCount++;
          this.metrics.totalBytesRead += decompressed.length;
        } else {
          cached.data = JSON.parse(raw.toString('utf-8'));
          this.metrics.totalBytesRead += raw.length;
        }
        this.metrics.diskReadCount++;
        this.metrics.diskReadLazyCount++;
      } catch (error) {
        this.metrics.diskReadFailCount++;
        logger.warn(`Failed to load persisted data for ${detailId}`, error);
        throw new Error(`DetailId not found or expired: ${detailId}`, { cause: error });
      }
    }

    cached.lastAccessedAt = now;
    cached.accessCount++;

    if (this.AUTO_EXTEND_ON_ACCESS) {
      const remainingTime = cached.expiresAt - now;
      if (remainingTime < 5 * 60 * 1000) {
        cached.expiresAt = Math.min(now + this.EXTEND_DURATION, now + this.MAX_TTL);
        logger.debug(
          `Auto-extended detailId ${detailId}, new expiry: ${new Date(cached.expiresAt).toISOString()}`,
        );
      }
    }

    if (path) {
      return this.getByPath(cached.data, path) as T;
    }

    return cached.data as T;
  }

  private getByPath(obj: unknown, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        throw new Error(`Path not found: ${path} (stopped at ${key})`);
      }
      current = this.readPathSegment(current, key);
    }

    return current;
  }

  private generateSummaryFromJson(data: unknown, jsonStr: string, size: number): DataSummary {
    const type = Array.isArray(data) ? 'array' : typeof data;

    const summary: DataSummary = {
      type,
      size,
      sizeKB: (size / 1024).toFixed(1) + 'KB',
      preview: jsonStr.substring(0, 200) + (size > 200 ? '...' : ''),
    };

    if (this.isRecord(data)) {
      const keys = Object.keys(data);
      summary.structure = {
        keys: keys.slice(0, 50),
      };

      if (!Array.isArray(data)) {
        const methods = keys.filter((k) => typeof data[k] === 'function');
        const properties = keys.filter((k) => typeof data[k] !== 'function');

        summary.structure.methods = methods.slice(0, 30);
        summary.structure.properties = properties.slice(0, 50);
      } else {
        summary.structure.length = data.length;
      }
    }

    return summary;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        this.cache.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} expired detailed data entries`);
    }
  }

  private evictLRU(): void {
    if (this.cache.size === 0) return;

    // Size-aware eviction: if total memory exceeds soft limit, evict largest LRU entries
    const totalMemory = this.computeTotalMemory();
    if (totalMemory > this.MAX_TOTAL_MEMORY_BYTES) {
      this.evictBySize(totalMemory - this.MAX_TOTAL_MEMORY_BYTES);
      return;
    }

    // Standard LRU eviction by count
    let oldestId: string | null = null;
    let oldestAccessTime = Infinity;

    for (const [id, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestAccessTime) {
        oldestAccessTime = entry.lastAccessedAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      const entry = this.cache.get(oldestId)!;
      this.cache.delete(oldestId);
      this.metrics.evictedByLRUCount++;
      logger.info(
        `Evicted LRU entry: ${oldestId}, last accessed: ${new Date(entry.lastAccessedAt).toISOString()}, access ` +
          `count: ${entry.accessCount}`,
      );
    }
  }

  /** Evict entries (starting with least-recently-used) until `bytesToFree` bytes are freed. */
  private evictBySize(bytesToFree: number): void {
    const sorted = Array.from(this.cache.entries()).toSorted(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt,
    );

    let freed = 0;
    for (const [id, entry] of sorted) {
      if (freed >= bytesToFree) break;
      this.cache.delete(id);
      freed += entry.size;
      this.metrics.evictedBySizeCount++;
      logger.info(`Evicted oversized entry: ${id}, freed: ${(entry.size / 1024).toFixed(1)}KB`);
    }
  }

  /** Compute total in-memory data size across all cache entries. */
  private computeTotalMemory(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += entry.size;
    }
    return total;
  }

  /**
   * Persist data to disk, optionally gzip-compressed.
   * Returns the number of bytes written.
   */
  private async persistToDisk(filePath: string, data: unknown, compress: boolean): Promise<number> {
    const json = JSON.stringify(data);
    if (compress) {
      const compressed = (await gzipAsync(Buffer.from(json, 'utf-8'))) as Buffer;
      await fs.writeFile(filePath, compressed);
      this.metrics.gzipCompressCount++;
      return compressed.length;
    }
    await fs.writeFile(filePath, json, 'utf-8');
    return json.length;
  }

  extend(detailId: string, additionalTime?: number): void {
    const cached = this.cache.get(detailId);

    if (!cached) {
      throw new Error(`DetailId not found: ${detailId}`);
    }

    const now = Date.now();
    if (now > cached.expiresAt) {
      throw new Error(`DetailId already expired: ${detailId}`);
    }

    const extendBy = additionalTime || this.EXTEND_DURATION;
    const newExpiresAt = Math.min(cached.expiresAt + extendBy, now + this.MAX_TTL);
    cached.expiresAt = newExpiresAt;

    logger.info(
      `Extended detailId ${detailId} by ${extendBy / 1000}s, new expiry: ${new Date(newExpiresAt).toISOString()}`,
    );
  }

  getStats() {
    let totalSize = 0;
    let totalAccessCount = 0;
    let persistedCount = 0;
    let compressedCount = 0;
    const entries = Array.from(this.cache.values());

    for (const entry of entries) {
      totalSize += entry.size;
      totalAccessCount += entry.accessCount;
      if (entry.persistPath) persistedCount++;
      if (entry.compressed) compressedCount++;
    }

    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.MAX_CACHE_SIZE,
      totalMemoryMB: (totalSize / (1024 * 1024)).toFixed(2),
      maxMemoryMB: (this.MAX_TOTAL_MEMORY_BYTES / (1024 * 1024)).toFixed(0),
      memoryUtilization: ((totalSize / this.MAX_TOTAL_MEMORY_BYTES) * 100).toFixed(1) + '%',
      defaultTTLSeconds: this.DEFAULT_TTL / 1000,
      maxTTLSeconds: this.MAX_TTL / 1000,
      totalSizeKB: (totalSize / 1024).toFixed(1),
      avgAccessCount: entries.length > 0 ? (totalAccessCount / entries.length).toFixed(1) : '0',
      autoExtendEnabled: this.AUTO_EXTEND_ON_ACCESS,
      extendDurationSeconds: this.EXTEND_DURATION / 1000,
      persistence: {
        enabled: this.persistenceEnabled,
        persistedCount,
        compressedCount,
        gzipEnabled: ENABLE_GZIP,
        gzipThresholdKB: (GZIP_THRESHOLD_BYTES / 1024).toFixed(1),
      },
      metrics: { ...this.metrics },
    };
  }

  getDetailedStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([id, entry]) => ({
      detailId: id,
      sizeKB: (entry.size / 1024).toFixed(1),
      createdAt: new Date(entry.createdAt).toISOString(),
      lastAccessedAt: new Date(entry.lastAccessedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      remainingSeconds: Math.max(0, Math.floor((entry.expiresAt - now) / 1000)),
      accessCount: entry.accessCount,
      isExpired: now > entry.expiresAt,
    }));

    entries.sort(
      (a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime(),
    );

    return entries;
  }

  clear(): void {
    this.cache.clear();
    logger.info('Cleared all detailed data cache');
  }
}
