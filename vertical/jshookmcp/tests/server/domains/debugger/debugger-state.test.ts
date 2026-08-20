import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolError } from '@errors/ToolError';
import { DebuggerStateHandlers } from '@server/domains/debugger/handlers/debugger-state';
import { buildTestUrl } from '@tests/shared/test-urls';

describe('DebuggerStateHandlers', () => {
  const debuggerManager = {
    waitForPaused: vi.fn(),
    getPausedState: vi.fn(),
    getScopeVariables: vi.fn(),
  };

  const runtimeInspector = {
    getCallStack: vi.fn(),
  };

  let handlers: DebuggerStateHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new DebuggerStateHandlers({
      debuggerManager: debuggerManager as any,
      runtimeInspector: runtimeInspector as any,
    });
  });

  it('waits for paused state and returns the top frame location', async () => {
    debuggerManager.waitForPaused.mockResolvedValueOnce({
      reason: 'breakpoint',
      callFrames: [{ location: { url: 'app.js', lineNumber: 7, columnNumber: 1 } }],
      hitBreakpoints: ['bp-1'],
    });

    const body = parseJson<any>(await handlers.handleDebuggerWaitForPaused({ timeout: 1234 }));

    expect(debuggerManager.waitForPaused).toHaveBeenCalledWith(1234);
    expect(body).toEqual({
      success: true,
      paused: true,
      reason: 'breakpoint',
      location: { url: 'app.js', lineNumber: 7, columnNumber: 1 },
      hitBreakpoints: ['bp-1'],
    });
  });

  it('returns a failure payload for generic wait errors', async () => {
    debuggerManager.waitForPaused.mockRejectedValueOnce(new Error('timed out'));

    const body = parseJson<any>(await handlers.handleDebuggerWaitForPaused({}));

    expect(debuggerManager.waitForPaused).toHaveBeenCalledWith(30000);
    expect(body).toEqual({
      success: false,
      paused: false,
      message: 'timed out',
    });
  });

  it('rethrows ToolError instances from waitForPaused', async () => {
    debuggerManager.waitForPaused.mockRejectedValueOnce(
      new ToolError('PREREQUISITE', 'debugger not enabled'),
    );

    await expect(handlers.handleDebuggerWaitForPaused({})).rejects.toThrow('debugger not enabled');
  });

  it('returns a non-paused payload when the debugger is running', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce(undefined);

    const body = parseJson<any>(await handlers.handleDebuggerGetPausedState({}));

    expect(body).toEqual({
      paused: false,
      message: 'Debugger is not paused',
    });
  });

  it('returns paused state details', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce({
      reason: 'exception',
      callFrames: [
        {
          functionName: 'main',
          location: { url: 'app.js', lineNumber: 10, columnNumber: 5 },
        },
      ],
      hitBreakpoints: ['bp-2'],
      timestamp: 1710000000000,
    });

    const body = parseJson<any>(await handlers.handleDebuggerGetPausedState({}));

    expect(body).toEqual({
      paused: true,
      reason: 'exception',
      frameCount: 1,
      topFrame: {
        functionName: 'main',
        location: { url: 'app.js', lineNumber: 10, columnNumber: 5 },
      },
      hitBreakpoints: ['bp-2'],
      timestamp: 1710000000000,
    });
  });

  it('captures a breakpoint hit with call stack and top-frame scope', async () => {
    debuggerManager.waitForPaused.mockResolvedValueOnce({
      reason: 'breakpoint',
      callFrames: [
        {
          callFrameId: 'paused-frame',
          functionName: 'fallback',
          url: 'fallback.js',
          location: { scriptId: 'script-1', lineNumber: 1, columnNumber: 0 },
          scopeChain: [],
        },
      ],
      hitBreakpoints: ['bp-1'],
      timestamp: 1710000001000,
    });
    runtimeInspector.getCallStack.mockResolvedValueOnce({
      reason: 'breakpoint',
      callFrames: [
        {
          callFrameId: 'frame-1',
          functionName: 'render',
          location: { url: 'app.js', lineNumber: 7, columnNumber: 2 },
          scopeChain: [{}, {}],
        },
      ],
    });
    debuggerManager.getScopeVariables.mockResolvedValueOnce({
      success: true,
      variables: [{ name: 'token', value: 'abc', type: 'string', scope: 'local' }],
      callFrameId: 'frame-1',
      totalScopes: 1,
      successfulScopes: 1,
    });

    const body = parseJson<any>(
      await handlers.handleDebuggerCaptureHit({
        timeout: 1234,
        includeObjectProperties: true,
        maxDepth: 2,
      }),
    );

    expect(debuggerManager.waitForPaused).toHaveBeenCalledWith(1234);
    expect(runtimeInspector.getCallStack).toHaveBeenCalledOnce();
    expect(debuggerManager.getScopeVariables).toHaveBeenCalledWith({
      callFrameId: 'frame-1',
      includeObjectProperties: true,
      maxDepth: 2,
      skipErrors: true,
    });
    expect(body).toEqual({
      success: true,
      paused: true,
      reason: 'breakpoint',
      hitBreakpoints: ['bp-1'],
      timestamp: 1710000001000,
      topFrame: {
        callFrameId: 'frame-1',
        functionName: 'render',
        url: 'app.js',
        location: { url: 'app.js', lineNumber: 7, columnNumber: 2 },
        scopeCount: 2,
      },
      callStack: {
        frameCount: 1,
        reason: 'breakpoint',
        frames: [
          {
            index: 0,
            callFrameId: 'frame-1',
            functionName: 'render',
            url: 'app.js',
            location: { url: 'app.js', lineNumber: 7, columnNumber: 2 },
            scopeCount: 2,
          },
        ],
      },
      scope: {
        success: true,
        variables: [{ name: 'token', value: 'abc', type: 'string', scope: 'local' }],
        callFrameId: 'frame-1',
        totalScopes: 1,
        successfulScopes: 1,
      },
      errors: [],
    });
  });

  it('returns captured pause data when optional scope capture fails', async () => {
    debuggerManager.waitForPaused.mockResolvedValueOnce({
      reason: 'breakpoint',
      callFrames: [
        {
          callFrameId: 'frame-2',
          functionName: 'main',
          url: 'app.js',
          location: { scriptId: 'script-1', lineNumber: 3, columnNumber: 0 },
          scopeChain: [],
        },
      ],
      hitBreakpoints: ['bp-2'],
      timestamp: 1710000002000,
    });
    runtimeInspector.getCallStack.mockResolvedValueOnce(undefined);
    debuggerManager.getScopeVariables.mockRejectedValueOnce(new Error('scope failed'));

    const body = parseJson<any>(await handlers.handleDebuggerCaptureHit({}));

    expect(body.success).toBe(true);
    expect(body.topFrame.callFrameId).toBe('frame-2');
    expect(body.scope).toBeUndefined();
    expect(body.errors).toEqual(['scope: scope failed']);
  });

  it('returns guidance when call stack is unavailable', async () => {
    runtimeInspector.getCallStack.mockResolvedValueOnce(undefined);

    const body = parseJson<any>(await handlers.handleGetCallStack({}));

    expect(body).toEqual({
      success: false,
      message: 'Not in paused state. Set a breakpoint and trigger it first.',
    });
  });

  it('maps call stack frames into response payload', async () => {
    runtimeInspector.getCallStack.mockResolvedValueOnce({
      reason: 'breakpoint',
      callFrames: [
        {
          callFrameId: 'frame-1',
          functionName: 'render',
          location: {
            url: buildTestUrl('app', { suffix: 'local', path: 'app.js' }),
            lineNumber: 15,
            columnNumber: 3,
          },
          scopeChain: [{}, {}],
        },
      ],
    });

    const body = parseJson<any>(await handlers.handleGetCallStack({}));

    expect(body).toEqual({
      success: true,
      callStack: {
        frameCount: 1,
        reason: 'breakpoint',
        frames: [
          {
            index: 0,
            callFrameId: 'frame-1',
            functionName: 'render',
            location: buildTestUrl('app', { suffix: 'local', path: 'app.js:15:3' }),
            scopeCount: 2,
          },
        ],
      },
    });
  });
});
