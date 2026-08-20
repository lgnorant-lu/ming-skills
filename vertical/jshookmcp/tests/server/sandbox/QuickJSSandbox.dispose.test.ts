/**
 * QuickJSSandbox — handle disposal regression tests.
 *
 * Regression for: on the evalCode error path (and in injectHelpers), only the
 * `error` handle was disposed — if the engine also returned a `value` handle
 * it leaked. Every returned handle must be disposed on all paths.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const disposed: string[] = [];
  const makeHandle = (name: string) => ({
    dispose: vi.fn(() => {
      disposed.push(name);
    }),
  });
  return { disposed, makeHandle };
});

vi.mock('quickjs-emscripten', () => {
  const { makeHandle } = mocks;
  return {
    getQuickJS: async () => ({
      newRuntime: () => {
        const context = {
          dump: vi.fn(() => 'boom'),
          evalCode: vi.fn(() => ({
            value: makeHandle('eval-value'),
            error: makeHandle('eval-error'),
          })),
          newObject: () => makeHandle('obj'),
          newFunction: (_name: string, _fn: unknown) => makeHandle('fn'),
          setProp: vi.fn(),
          getString: vi.fn(),
          getNumber: vi.fn(),
          typeof: vi.fn(),
          undefined: makeHandle('undefined'),
          true: makeHandle('true'),
          false: makeHandle('false'),
          global: {},
          dispose: vi.fn(),
        };
        return {
          setMemoryLimit: vi.fn(),
          setInterruptHandler: vi.fn(),
          newContext: () => context,
          dispose: vi.fn(),
        };
      },
    }),
  };
});

import { QuickJSSandbox } from '@server/sandbox/QuickJSSandbox';

describe('QuickJSSandbox handle disposal', () => {
  beforeEach(() => {
    mocks.disposed.length = 0;
  });

  it('disposes the value handle too when evalCode returns an error (execute)', async () => {
    const sandbox = new QuickJSSandbox();
    const result = await sandbox.execute('boom()');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(mocks.disposed).toContain('eval-value');
    expect(mocks.disposed).toContain('eval-error');
  });

  it('disposes the value handle too when evalCode returns an error (executeOneRound)', async () => {
    const sandbox = new QuickJSSandbox();
    const bridge = {
      setAllowlist: vi.fn(),
      hasPending: vi.fn(() => false),
      drainPending: vi.fn(() => []),
      enqueue: vi.fn(() => 'call-1'),
      listAvailableTools: vi.fn(() => []),
    } as never;

    const result = await sandbox.executeWithOrchestration('boom()', bridge);

    expect(result.ok).toBe(false);
    expect(mocks.disposed).toContain('eval-value');
    expect(mocks.disposed).toContain('eval-error');
  });
});
