import { describe, it, expect } from 'vitest';
import { diffSessionSnapshots } from '@server/instrumentation/snapshot-diff';
import {
  InstrumentationType,
  type InstrumentationArtifact,
  type InstrumentationOperation,
  type InstrumentationSessionSnapshot,
} from '@server/instrumentation/types';

let counter = 0;
const ts = () => 1_000_000 + counter++;

function session(
  id: string,
  operations: InstrumentationOperation[],
  artifacts: InstrumentationArtifact[],
): InstrumentationSessionSnapshot {
  return {
    session: {
      id,
      createdAt: ts(),
      operationCount: operations.length,
      artifactCount: artifacts.length,
      status: 'active',
    },
    stats: { operationCount: operations.length, artifactCount: artifacts.length },
    operations,
    artifacts,
  };
}

function op(
  id: string,
  sessionId: string,
  type: InstrumentationType,
  target: string,
): InstrumentationOperation {
  return { id, sessionId, type, target, config: {}, createdAt: ts(), status: 'active' };
}

function art(
  operationId: string,
  sessionId: string,
  type: InstrumentationType,
  data: Record<string, unknown>,
): InstrumentationArtifact {
  return { operationId, sessionId, type, timestamp: ts(), data };
}

describe('diffSessionSnapshots', () => {
  it('reports operations added in B and removed from A', () => {
    const a = session('a', [op('op1', 'a', InstrumentationType.RUNTIME_HOOK, 'f1')], []);
    const b = session('b', [op('op2', 'b', InstrumentationType.RUNTIME_HOOK, 'f2')], []);
    const diff = diffSessionSnapshots(a, b);
    expect(diff.operations.removedFromA.map((o) => o.id)).toEqual(['op1']);
    expect(diff.operations.addedInB.map((o) => o.id)).toEqual(['op2']);
    expect(diff.operations.common).toEqual([]);
  });

  it('reports common operations by id with type/target', () => {
    const a = session('a', [op('shared', 'a', InstrumentationType.RUNTIME_HOOK, 'f')], []);
    const b = session('b', [op('shared', 'b', InstrumentationType.RUNTIME_HOOK, 'f')], []);
    const diff = diffSessionSnapshots(a, b);
    expect(diff.operations.common).toEqual([
      { id: 'shared', type: InstrumentationType.RUNTIME_HOOK, target: 'f' },
    ]);
    expect(diff.operations.addedInB).toEqual([]);
    expect(diff.operations.removedFromA).toEqual([]);
  });

  it('diffs artifacts by type+data fingerprint', () => {
    const a = session(
      'a',
      [],
      [
        art('op1', 'a', InstrumentationType.RUNTIME_HOOK, { args: [1] }),
        art('op2', 'a', InstrumentationType.NETWORK_INTERCEPT, { url: '/x' }),
      ],
    );
    const b = session(
      'b',
      [],
      [
        art('op1', 'b', InstrumentationType.RUNTIME_HOOK, { args: [1] }),
        art('op3', 'b', InstrumentationType.FUNCTION_TRACE, { functionName: 'g' }),
      ],
    );
    const diff = diffSessionSnapshots(a, b);
    expect(diff.artifacts.common).toBe(1);
    expect(diff.artifacts.onlyInA).toBe(1);
    expect(diff.artifacts.onlyInB).toBe(1);
  });

  it('counts per-type artifact deltas', () => {
    const a = session(
      'a',
      [],
      [
        art('op1', 'a', InstrumentationType.RUNTIME_HOOK, { n: 1 }),
        art('op2', 'a', InstrumentationType.RUNTIME_HOOK, { n: 2 }),
      ],
    );
    const b = session('b', [], [art('op1', 'b', InstrumentationType.RUNTIME_HOOK, { n: 1 })]);
    const diff = diffSessionSnapshots(a, b);
    const runtimeRow = diff.artifacts.byType.find(
      (r) => r.type === InstrumentationType.RUNTIME_HOOK,
    );
    expect(runtimeRow).toEqual({
      type: InstrumentationType.RUNTIME_HOOK,
      countA: 2,
      countB: 1,
      delta: -1,
    });
  });

  it('computes operation and artifact count deltas', () => {
    const a = session(
      'a',
      [op('op1', 'a', InstrumentationType.RUNTIME_HOOK, 'f')],
      [art('op1', 'a', InstrumentationType.RUNTIME_HOOK, { x: 1 })],
    );
    const b = session(
      'b',
      [
        op('op1', 'b', InstrumentationType.RUNTIME_HOOK, 'f'),
        op('op2', 'b', InstrumentationType.RUNTIME_HOOK, 'g'),
      ],
      [
        art('op1', 'b', InstrumentationType.RUNTIME_HOOK, { x: 1 }),
        art('op2', 'b', InstrumentationType.RUNTIME_HOOK, { y: 2 }),
      ],
    );
    const diff = diffSessionSnapshots(a, b);
    expect(diff.stats.operationCountDelta).toBe(1);
    expect(diff.stats.artifactCountDelta).toBe(1);
  });

  it('is pure — does not mutate inputs', () => {
    const a = session('a', [op('op1', 'a', InstrumentationType.RUNTIME_HOOK, 'f')], []);
    const b = session('b', [], []);
    const aOpsBefore = a.operations.length;
    const bOpsBefore = b.operations.length;
    diffSessionSnapshots(a, b);
    expect(a.operations.length).toBe(aOpsBefore);
    expect(b.operations.length).toBe(bOpsBefore);
  });

  it('records both session ids in the diff', () => {
    const a = session('alpha', [], []);
    const b = session('beta', [], []);
    const diff = diffSessionSnapshots(a, b);
    expect(diff.sessions).toEqual({ aId: 'alpha', bId: 'beta' });
  });
});
