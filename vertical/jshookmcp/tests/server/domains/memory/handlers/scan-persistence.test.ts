import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createDiskScanSession,
  appendToDiskScan,
  readAllFromDiskScan,
  deleteDiskScanSession,
  getDiskScanSession,
  getDiskScanFileSize,
  listDiskScanSessions,
  initDiskScanPersistence,
  cleanupOrphanDiskScanFiles,
  disposeDiskScanPersistence,
  DISK_RECORD_SIZE,
} from '../../../../../src/server/domains/memory/handlers/scan-persistence';
import { DISK_SCAN_MAX_SESSIONS, DISK_SCAN_SESSION_TTL_MS } from '@src/constants';

describe('Disk Scan Persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Reset module-level session registry and sweep timer between tests.
    disposeDiskScanPersistence();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-persist-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('createDiskScanSession', () => {
    it('creates a session and empty backing file', () => {
      const session = createDiskScanSession('test-s1', 'int32', tmpDir);
      expect(session.sessionId).toBe('test-s1');
      expect(session.valueType).toBe('int32');
      expect(session.totalRecords).toBe(0);
      expect(fs.existsSync(session.filePath)).toBe(true);
      expect(fs.statSync(session.filePath).size).toBe(0);
    });

    it('session is retrievable via getDiskScanSession', () => {
      createDiskScanSession('test-s2', 'float', tmpDir);
      const retrieved = getDiskScanSession('test-s2');
      expect(retrieved).toBeDefined();
      expect(retrieved!.valueType).toBe('float');
    });
  });

  describe('appendToDiskScan', () => {
    it('appends records and updates totalRecords', () => {
      createDiskScanSession('test-s3', 'int32', tmpDir);

      appendToDiskScan('test-s3', [
        { address: BigInt('0x7FF612340000'), value: BigInt(100) },
        { address: BigInt('0x7FF612340010'), value: BigInt(200) },
        { address: BigInt('0x7FF612340020'), value: BigInt(300) },
      ]);

      const updated = getDiskScanSession('test-s3')!;
      expect(updated.totalRecords).toBe(3);

      // File size should be 3 * 16 = 48 bytes
      const size = getDiskScanFileSize('test-s3');
      expect(size).toBe(3 * DISK_RECORD_SIZE);
    });

    it('correctly writes binary LE addresses and values', () => {
      createDiskScanSession('test-s4', 'int64', tmpDir);
      appendToDiskScan('test-s4', [
        { address: BigInt('0xABCD'), value: BigInt('0x1234567890ABCDEF') },
      ]);

      const session = getDiskScanSession('test-s4')!;
      const buf = fs.readFileSync(session.filePath);
      expect(buf.length).toBe(DISK_RECORD_SIZE);

      // First 8 bytes: address 0xABCD in LE
      const addr = buf.readBigUInt64LE(0);
      expect(addr).toBe(BigInt('0xABCD'));

      // Next 8 bytes: value
      const val = buf.readBigUInt64LE(8);
      expect(val).toBe(BigInt('0x1234567890ABCDEF'));
    });

    it('rejects when totalRecords would exceed the cap', () => {
      // Create session and set totalRecords near the limit to verify the guard
      const session = createDiskScanSession('test-s5', 'byte', tmpDir);

      // Directly set totalRecords to simulate near-cap state
      // (we can't create 100M entries in-memory without OOM)
      const recordsToSimulate = 99_999_999; // 1 below max
      const buf = Buffer.alloc(DISK_RECORD_SIZE);
      buf.writeBigUInt64LE(BigInt(0), 0);
      buf.writeBigUInt64LE(BigInt(0), 8);
      // Write placeholder data and set the counter
      const batch = 1000;
      for (let i = 0; i < Math.min(batch, recordsToSimulate); i += 1) {
        fs.appendFileSync(session.filePath, buf);
      }
      // Set the in-memory counter
      (session as unknown as Record<string, unknown>).totalRecords = recordsToSimulate;

      // Adding 2 records would push it over the limit
      expect(() =>
        appendToDiskScan('test-s5', [
          { address: BigInt(1), value: BigInt(1) },
          { address: BigInt(2), value: BigInt(2) },
        ]),
      ).toThrow(/exceed/);
    });

    it('throws for unknown session', () => {
      expect(() =>
        appendToDiskScan('nonexistent', [{ address: BigInt(0), value: BigInt(0) }]),
      ).toThrow('not found');
    });
  });

  describe('readAllFromDiskScan', () => {
    it('reads back all addresses in order', () => {
      createDiskScanSession('test-s6', 'int32', tmpDir);
      appendToDiskScan('test-s6', [
        { address: BigInt('0x1000'), value: BigInt(10) },
        { address: BigInt('0x2000'), value: BigInt(20) },
        { address: BigInt('0x3000'), value: BigInt(30) },
      ]);

      const addresses = readAllFromDiskScan('test-s6');
      expect(addresses).toEqual(['0x1000', '0x2000', '0x3000']);
    });

    it('handles empty session (zero records)', () => {
      createDiskScanSession('test-s7', 'float', tmpDir);

      const addresses = readAllFromDiskScan('test-s7');
      expect(addresses).toEqual([]);
    });

    it('throws for unknown session', () => {
      expect(() => readAllFromDiskScan('no-such-session')).toThrow('not found');
    });
  });

  describe('deleteDiskScanSession', () => {
    it('deletes the session and its backing file', () => {
      const session = createDiskScanSession('test-s8', 'int32', tmpDir);
      expect(fs.existsSync(session.filePath)).toBe(true);

      const deleted = deleteDiskScanSession('test-s8');
      expect(deleted).toBe(true);
      expect(fs.existsSync(session.filePath)).toBe(false);
      expect(getDiskScanSession('test-s8')).toBeUndefined();
    });

    it('returns false for non-existent session', () => {
      expect(deleteDiskScanSession('no-such')).toBe(false);
    });
  });

  describe('listDiskScanSessions', () => {
    it('lists all active sessions', () => {
      createDiskScanSession('test-s9', 'int32', tmpDir);
      createDiskScanSession('test-s10', 'float', tmpDir);

      const sessions = listDiskScanSessions();
      const ids = sessions.map((s) => s.sessionId);
      expect(ids).toContain('test-s9');
      expect(ids).toContain('test-s10');
    });
  });

  describe('getDiskScanFileSize', () => {
    it('returns 0 for non-existent session', () => {
      expect(getDiskScanFileSize('no-such')).toBe(0);
    });

    it('returns correct file size', () => {
      createDiskScanSession('test-s11', 'int32', tmpDir);
      appendToDiskScan('test-s11', [
        { address: BigInt(1), value: BigInt(2) },
        { address: BigInt(3), value: BigInt(4) },
      ]);

      expect(getDiskScanFileSize('test-s11')).toBe(2 * DISK_RECORD_SIZE);
    });
  });

  describe('session cap', () => {
    it('rejects new sessions once the cap is reached', () => {
      for (let i = 0; i < DISK_SCAN_MAX_SESSIONS; i += 1) {
        createDiskScanSession(`cap-${i}`, 'int32', tmpDir);
      }

      expect(() => createDiskScanSession('cap-overflow', 'int32', tmpDir)).toThrow(/limit reached/);
      expect(getDiskScanSession('cap-overflow')).toBeUndefined();

      // Deleting one session frees a slot for a new one.
      expect(deleteDiskScanSession('cap-0')).toBe(true);
      expect(() => createDiskScanSession('cap-again', 'int32', tmpDir)).not.toThrow();
    });
  });

  describe('idle sweep', () => {
    it('expires idle sessions and unlinks their backing files', () => {
      vi.useFakeTimers();
      try {
        // Timer wiring happens at init (construction) time; the deferred
        // orphan cleanup fires harmlessly under the fake clock (real tmp
        // files have real mtimes, which the epoch-based clock never sees as
        // stale — and the test sessions live in a mkdtemp subdir anyway).
        initDiskScanPersistence();
        const stale = createDiskScanSession('sweep-stale', 'int32', tmpDir);
        appendToDiskScan('sweep-stale', [{ address: BigInt(1), value: BigInt(2) }]);
        createDiskScanSession('sweep-kept', 'int32', tmpDir);

        vi.advanceTimersByTime(DISK_SCAN_SESSION_TTL_MS / 2);
        // Access refreshes the idle clock.
        expect(getDiskScanSession('sweep-kept')).toBeDefined();
        // Keep total elapsed time below 2×TTL so the touched session (idle
        // only since the halfway point) stays below the TTL while the stale
        // one is well past it.
        vi.advanceTimersByTime(DISK_SCAN_SESSION_TTL_MS - 1);

        expect(getDiskScanSession('sweep-stale')).toBeUndefined();
        expect(fs.existsSync(stale.filePath)).toBe(false);
        expect(getDiskScanSession('sweep-kept')).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('initDiskScanPersistence', () => {
    it('reclaims stale orphan scan files asynchronously without blocking init', async () => {
      const stalePath = path.join(os.tmpdir(), `jshook-scan-orphan-${process.pid}-stale.bin`);
      const freshPath = path.join(os.tmpdir(), `jshook-scan-orphan-${process.pid}-fresh.bin`);
      const nonMatchingPath = path.join(os.tmpdir(), `jshook-scan-orphan-${process.pid}.txt`);
      fs.writeFileSync(stalePath, 'orphan');
      fs.writeFileSync(freshPath, 'orphan');
      fs.writeFileSync(nonMatchingPath, 'orphan');
      const past = new Date(Date.now() - DISK_SCAN_SESSION_TTL_MS - 60_000);
      fs.utimesSync(stalePath, past, past);
      try {
        // init returns synchronously (timer wiring only); cleanup is deferred
        // on an unref'd 0ms timer so domain activation is never blocked.
        const startedAt = Date.now();
        initDiskScanPersistence();
        expect(Date.now() - startedAt).toBeLessThan(1_000);

        // Await the cleanup explicitly — both the direct call and the
        // deferred trigger scheduled by init are idempotent.
        await cleanupOrphanDiskScanFiles();

        // Stale orphan reclaimed; a fresh file may belong to another process
        // and files that don't match the scan naming pattern are left alone.
        expect(fs.existsSync(stalePath)).toBe(false);
        expect(fs.existsSync(freshPath)).toBe(true);
        expect(fs.existsSync(nonMatchingPath)).toBe(true);
      } finally {
        for (const p of [stalePath, freshPath, nonMatchingPath]) {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
      }
    });
  });

  describe('cleanupOrphanDiskScanFiles concurrency', () => {
    it('bounds concurrent stat/unlink to a fixed batch size', async () => {
      const names = Array.from({ length: 100 }, (_, i) => `jshook-scan-orphan-${i}.bin`);
      const readdirSpy = vi
        .spyOn(fs.promises, 'readdir')
        .mockResolvedValue(names as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

      let inFlight = 0;
      let maxInFlight = 0;
      const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { isFile: () => true, mtimeMs: 0 } as unknown as fs.Stats;
      });
      const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

      try {
        await cleanupOrphanDiskScanFiles();

        expect(statSpy).toHaveBeenCalledTimes(100);
        expect(unlinkSpy).toHaveBeenCalledTimes(100);
        // The batching loop keeps at most 8 stat/unlink pairs in flight at a
        // time; an unbounded Promise.all over the whole directory would reach
        // 100 concurrent stats.
        expect(maxInFlight).toBeLessThanOrEqual(8);
      } finally {
        readdirSpy.mockRestore();
        statSpy.mockRestore();
        unlinkSpy.mockRestore();
      }
    });
  });
});
