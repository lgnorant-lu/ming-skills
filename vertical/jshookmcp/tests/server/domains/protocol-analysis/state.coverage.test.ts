/**
 * Coverage tests for protocol-analysis shared state helpers — lazy engine /
 * inferrer creation + event emission (eventBus optional).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  emitProtocolEvent,
  getEngine,
  getInferrer,
  type ProtocolSharedState,
} from '@server/domains/protocol-analysis/handlers/shared/state';

describe('getEngine — lazy creation + caching', () => {
  it('creates a ProtocolPatternEngine on first access', () => {
    const state: ProtocolSharedState = {};
    const eng = getEngine(state);
    expect(eng).toBeDefined();
    expect(state.engine).toBe(eng);
  });

  it('returns the cached instance on subsequent calls', () => {
    const state: ProtocolSharedState = {};
    const a = getEngine(state);
    const b = getEngine(state);
    expect(a).toBe(b);
  });
});

describe('getInferrer — lazy creation + caching', () => {
  it('creates a StateMachineInferrer on first access + caches', () => {
    const state: ProtocolSharedState = {};
    const inf = getInferrer(state);
    expect(inf).toBeDefined();
    expect(state.inferrer).toBe(inf);
    expect(getInferrer(state)).toBe(inf);
  });
});

describe('emitProtocolEvent', () => {
  it('calls eventBus.emit with an added timestamp', () => {
    const emit = vi.fn();
    const state: ProtocolSharedState = { eventBus: { emit } as never };
    emitProtocolEvent(state, 'protocol:pcapng_read', {
      path: '/x.pcapng',
      blockCount: 3,
      packetCount: 1,
    } as never);
    expect(emit).toHaveBeenCalledTimes(1);
    const [event, payload] = emit.mock.calls[0]!;
    expect(event).toBe('protocol:pcapng_read');
    expect(payload).toMatchObject({ path: '/x.pcapng', blockCount: 3 });
    expect(typeof payload.timestamp).toBe('string');
  });

  it('is a no-op when eventBus is undefined', () => {
    const state: ProtocolSharedState = {};
    expect(() =>
      emitProtocolEvent(state, 'protocol:pcapng_read', {
        path: '/x',
        blockCount: 0,
        packetCount: 0,
      } as never),
    ).not.toThrow();
  });
});
