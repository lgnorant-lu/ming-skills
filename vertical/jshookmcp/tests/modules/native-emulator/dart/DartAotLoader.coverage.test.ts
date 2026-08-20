/**
 * Coverage tests for DartAotLoader query helpers — findCodeByName /
 * findCodeByAddress / getObjectPool are pure searches over a loaded snapshot
 * (no file IO). loadSnapshot's APK/libapp.so path needs real fixtures + is
 * covered elsewhere; these tests cover the in-memory query surface.
 */

import { describe, expect, it } from 'vitest';
import { DartAotLoader } from '@modules/native-emulator/dart/DartAotLoader';

const loader = new DartAotLoader();

const snapshot = {
  version: '1.0',
  numClusters: 0,
  dataStartOffset: 0,
  clusters: [],
  codeObjects: [
    { name: 'main', entryPoint: 0x1000n, instructions: [], objectPoolAddress: 0x2000n },
    { name: 'helper', entryPoint: 0x2000n, instructions: [], objectPoolAddress: 0x3000n },
  ],
  objectPools: [
    { address: 0x2000n, pool: { entries: [] } },
    { address: 0x3000n, pool: { entries: [{ kind: 'int', value: 42 }] } },
  ],
} as never;

describe('DartAotLoader.findCodeByName', () => {
  it('finds a Code object by name', () => {
    const code = loader.findCodeByName(snapshot, 'main');
    expect(code?.entryPoint).toBe(0x1000n);
  });

  it('returns undefined for an unknown name', () => {
    expect(loader.findCodeByName(snapshot, 'nope')).toBeUndefined();
  });
});

describe('DartAotLoader.findCodeByAddress', () => {
  it('finds a Code object by entry point', () => {
    expect(loader.findCodeByAddress(snapshot, 0x2000n)?.name).toBe('helper');
  });

  it('returns undefined for an unmatched address', () => {
    expect(loader.findCodeByAddress(snapshot, 0xdeadbeefn)).toBeUndefined();
  });
});

describe('DartAotLoader.getObjectPool', () => {
  it('returns the pool registered at a given address', () => {
    const pool = loader.getObjectPool(snapshot, 0x3000n);
    expect(pool).toBeDefined();
    expect((pool as unknown as { entries: unknown[] }).entries.length).toBe(1);
  });

  it('returns undefined when no pool is registered at the address', () => {
    expect(loader.getObjectPool(snapshot, 0x5000n)).toBeUndefined();
  });
});
