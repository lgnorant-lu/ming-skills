/**
 * Dart runtime state bugs:
 *   1. DartAotExecutor must serialise parsed ObjectPool entries into the
 *      registry buffer (an all-zero buffer reads as an empty pool).
 *   2. DartRuntime.readDartRegister must read the live CPU register file, not
 *      the JS-side initialisation mirrors (which go stale once guest code runs).
 *   3. DartSnapshotSessionManager must reserve the session slot before the
 *      await so concurrent createSession calls cannot overshoot maxSessions.
 */
import { describe, expect, it, vi } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { DartAotExecutor } from '@modules/native-emulator/dart/DartAotExecutor';
import { DART_PP, DART_THR, DartRuntime } from '@modules/native-emulator/dart/DartRuntime';
import { DartSnapshotSessionManager } from '@modules/native-emulator/dart/DartSnapshotSessionManager';
import { ObjectPool, ObjectPoolRegistry } from '@modules/native-emulator/dart/ObjectPool';
import type { LoadedSnapshot } from '@modules/native-emulator/dart/DartAotLoader';

function makePoolBuffer(entries: bigint[]): Uint8Array {
  const data = new Uint8Array(8 + entries.length * 8);
  const view = new DataView(data.buffer);
  view.setUint32(0, entries.length, true);
  entries.forEach((value, i) => view.setBigUint64(8 + i * 8, value, true));
  return data;
}

describe('DartAotExecutor — ObjectPool entries are serialised', () => {
  it('registers pool bytes that carry the parsed entry values', () => {
    const entries = [0x1001n, 0x12345678n];
    const pool = new ObjectPool(makePoolBuffer(entries));
    const snapshot: LoadedSnapshot = {
      header: {} as LoadedSnapshot['header'],
      clusters: [],
      codeObjects: [],
      objectPools: [{ address: 0x8000n, pool }],
      rawBytes: new Uint8Array(0),
    };

    const spy = vi.spyOn(ObjectPoolRegistry.prototype, 'register');
    const executor = new DartAotExecutor();
    executor.loadFromSnapshot(snapshot);
    try {
      expect(spy).toHaveBeenCalledTimes(1);
      const [address, data] = spy.mock.calls[0]!;
      expect(address).toBe(0x8000n);
      const view = new DataView(data.buffer);
      expect(view.getUint32(0, true)).toBe(2); // header length
      expect(view.getBigUint64(8, true)).toBe(0x1001n);
      expect(view.getBigUint64(16, true)).toBe(0x12345678n);
      // The registered bytes must round-trip through ObjectPool parsing.
      const reparsed = new ObjectPool(data, 0x8000n);
      expect(reparsed.lookup(0)).toBe(0x1001n);
      expect(reparsed.lookup(8)).toBe(0x12345678n);
    } finally {
      spy.mockRestore();
    }
  });

  it('registers a valid empty pool for zero entries', () => {
    const pool = new ObjectPool(makePoolBuffer([]));
    const snapshot: LoadedSnapshot = {
      header: {} as LoadedSnapshot['header'],
      clusters: [],
      codeObjects: [],
      objectPools: [{ address: 0x9000n, pool }],
      rawBytes: new Uint8Array(0),
    };
    const spy = vi.spyOn(ObjectPoolRegistry.prototype, 'register');
    const executor = new DartAotExecutor();
    executor.loadFromSnapshot(snapshot);
    try {
      const data = spy.mock.calls[0]![1];
      expect(new DataView(data.buffer).getUint32(0, true)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('DartRuntime — readDartRegister reads live CPU state', () => {
  it('reflects a guest modification of PP (x27) made through the CPU', () => {
    const cpu = new CpuEngine();
    const runtime = new DartRuntime(cpu);
    runtime.initializeRuntime(0x7000_0000n, 0x1111n, 0x1n, 0x8000_0000n);
    // Guest code (or a caller writing the register directly) updates PP.
    cpu.writeGpr(DART_PP, 0x9999n);
    expect(runtime.readDartRegister(DART_PP)).toBe(0x9999n);
    // THR and HEAP follow the register file too.
    cpu.writeGpr(DART_THR, 0x7000_1000n);
    expect(runtime.readDartRegister(DART_THR)).toBe(0x7000_1000n);
  });

  it('returns undefined for non-Dart registers', () => {
    const runtime = new DartRuntime(new CpuEngine());
    expect(runtime.readDartRegister(0)).toBeUndefined();
    expect(runtime.readDartRegister(31)).toBeUndefined();
  });
});

describe('DartSnapshotSessionManager — maxSessions reservation', () => {
  it('two concurrent createSession calls cannot overshoot maxSessions=1', async () => {
    const manager = new DartSnapshotSessionManager({ maxSessions: 1 });
    try {
      // A loader whose parse completes only after both calls have passed the
      // (single-threaded) await point of the first session.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slowLoader = {
        loadSnapshot: vi.fn(async () => {
          await gate;
          return {
            header: {},
            clusters: [],
            codeObjects: [],
            objectPools: [],
            rawBytes: new Uint8Array(0),
          };
        }),
      } as unknown as Parameters<DartSnapshotSessionManager['createSession']>[1];

      const first = manager.createSession('/x/app.so', slowLoader);
      const second = manager.createSession('/x/app2.so', slowLoader);
      release();
      const [a, b] = await Promise.allSettled([first, second]);
      expect(a.status).toBe('fulfilled');
      expect(b.status).toBe('rejected'); // slot was reserved → limit enforced
      expect(manager.count()).toBe(1);
    } finally {
      manager.dispose();
    }
  });

  it('a failed parse releases the reservation', async () => {
    const manager = new DartSnapshotSessionManager({ maxSessions: 1 });
    try {
      const failingLoader = {
        loadSnapshot: vi.fn(async () => {
          throw new Error('snapshot corrupt');
        }),
      } as unknown as Parameters<DartSnapshotSessionManager['createSession']>[1];
      await expect(manager.createSession('/x/app.so', failingLoader)).rejects.toThrow(
        'snapshot corrupt',
      );
      expect(manager.count()).toBe(0);
      // The freed slot admits a new session afterwards.
      const okLoader = {
        loadSnapshot: vi.fn(async () => ({
          header: {},
          clusters: [],
          codeObjects: [],
          objectPools: [],
          rawBytes: new Uint8Array(0),
        })),
      } as unknown as Parameters<DartSnapshotSessionManager['createSession']>[1];
      const session = await manager.createSession('/x/app2.so', okLoader);
      expect(manager.count()).toBe(1);
      expect(session.path).toBe('/x/app2.so');
    } finally {
      manager.dispose();
    }
  });
});
