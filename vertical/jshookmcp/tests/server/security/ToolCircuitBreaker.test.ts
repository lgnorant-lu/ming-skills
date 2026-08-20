import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ToolCircuitBreaker } from '@server/security/ToolCircuitBreaker';
import { runWithToolRequestContext } from '@server/runtime/ToolRequestContext';

describe('ToolCircuitBreaker', () => {
  let breaker: ToolCircuitBreaker;

  beforeEach(() => {
    breaker = new ToolCircuitBreaker();
    vi.clearAllMocks();
  });

  it('starts in closed state for unknown tools', () => {
    expect(breaker.shouldBlock('tool_a')).toBe(false);
    expect(breaker.getState('tool_a')).toBeUndefined();
  });

  it('transitions to open after reaching failure threshold', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    expect(breaker.getState('tool_a')?.state).toBe('closed');

    breaker.recordFailure('tool_a');
    expect(breaker.getState('tool_a')?.state).toBe('open');
    expect(breaker.getState('tool_a')?.failureCount).toBe(3);
  });

  it('blocks calls when in open state', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');

    expect(breaker.shouldBlock('tool_a')).toBe(true);
  });

  it('transitions to half-open after recovery period', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    expect(breaker.getState('tool_a')?.state).toBe('open');

    const entry = breaker.getState('tool_a')!;
    entry.lastFailureTime = Date.now() - breaker.getRecoveryMs() - 1;

    expect(breaker.shouldBlock('tool_a')).toBe(false);
    expect(breaker.getState('tool_a')?.state).toBe('half-open');
  });

  it('transitions half-open to closed on success', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');

    const entry = breaker.getState('tool_a')!;
    entry.lastFailureTime = Date.now() - breaker.getRecoveryMs() - 1;
    breaker.shouldBlock('tool_a');
    expect(breaker.getState('tool_a')?.state).toBe('half-open');

    breaker.recordSuccess('tool_a');
    expect(breaker.getState('tool_a')?.state).toBe('closed');
    expect(breaker.getState('tool_a')?.failureCount).toBe(0);
  });

  it('transitions half-open back to open on failure', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');

    const entry = breaker.getState('tool_a')!;
    entry.lastFailureTime = Date.now() - breaker.getRecoveryMs() - 1;
    breaker.shouldBlock('tool_a');
    expect(breaker.getState('tool_a')?.state).toBe('half-open');

    breaker.recordFailure('tool_a');
    expect(breaker.getState('tool_a')?.state).toBe('open');
  });

  it('resets failure count on success in closed state', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    expect(breaker.getState('tool_a')?.failureCount).toBe(2);

    breaker.recordSuccess('tool_a');
    expect(breaker.getState('tool_a')?.failureCount).toBe(0);
    expect(breaker.getState('tool_a')?.state).toBe('closed');
  });

  it('recordSuccess is a no-op for unknown tools', () => {
    breaker.recordSuccess('unknown');
    expect(breaker.getState('unknown')).toBeUndefined();
  });

  it('getStates returns all tracked tool states', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_b');

    const states = breaker.getStates();
    expect(states).toHaveLength(2);
    const names = states.map((s) => s.toolName);
    expect(names).toContain('tool_a');
    expect(names).toContain('tool_b');
  });

  it('reset clears state for a specific tool', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    expect(breaker.getState('tool_a')?.state).toBe('open');

    breaker.reset('tool_a');
    expect(breaker.getState('tool_a')).toBeUndefined();
    expect(breaker.shouldBlock('tool_a')).toBe(false);
  });

  it('reset does not affect other tools', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_b');

    breaker.reset('tool_a');
    expect(breaker.getState('tool_a')).toBeUndefined();
    expect(breaker.getState('tool_b')).toBeDefined();
  });

  it('half-open allows only one probe call', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');

    const entry = breaker.getState('tool_a')!;
    entry.lastFailureTime = Date.now() - breaker.getRecoveryMs() - 1;

    expect(breaker.shouldBlock('tool_a')).toBe(false);
    expect(breaker.shouldBlock('tool_a')).toBe(true);
  });

  it('tracks multiple tools independently', () => {
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');

    expect(breaker.shouldBlock('tool_a')).toBe(true);
    expect(breaker.shouldBlock('tool_b')).toBe(false);

    breaker.recordFailure('tool_b');
    expect(breaker.getState('tool_b')?.failureCount).toBe(1);
    expect(breaker.getState('tool_b')?.state).toBe('closed');
  });

  it('failure count increments beyond threshold', () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure('tool_a');
    }
    expect(breaker.getState('tool_a')?.failureCount).toBe(5);
    expect(breaker.getState('tool_a')?.state).toBe('open');
  });

  it('getRecoveryMs returns 30000', () => {
    expect(breaker.getRecoveryMs()).toBe(30_000);
  });

  it('isolates failures across ten MCP sessions', async () => {
    await runWithToolRequestContext({ sessionId: 'session-0' }, async () => {
      breaker.recordFailure('page_navigate');
      breaker.recordFailure('page_navigate');
      breaker.recordFailure('page_navigate');
      expect(breaker.shouldBlock('page_navigate')).toBe(true);
    });

    for (let index = 1; index < 10; index++) {
      await runWithToolRequestContext({ sessionId: `session-${index}` }, async () => {
        expect(breaker.shouldBlock('page_navigate')).toBe(false);
        expect(breaker.getState('page_navigate')).toBeUndefined();
      });
    }
  });
});
