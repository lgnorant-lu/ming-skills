import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { DebuggerSessionManager } from '@modules/debugger/DebuggerSessionManager';

describe('DebuggerSessionManager', () => {
  let workDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    workDir = await mkdtemp(join(tmpdir(), 'dbg-session-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await rm(workDir, { recursive: true, force: true });
  });

  it('exports session with breakpoints and metadata', () => {
    const managerMock = {
      getBreakpoints: () =>
        new Map([
          [
            'bp1',
            {
              location: { url: 'https://a.js', lineNumber: 1, columnNumber: 2 },
              condition: 'x>0',
              enabled: true,
            },
          ],
        ]),
      getPauseOnExceptionsState: () => 'uncaught',
    } as any;

    const sessionManager = new DebuggerSessionManager(managerMock);
    const session = sessionManager.exportSession({ tag: 'unit' });

    expect(session.version).toBe('1.0');
    expect(session.breakpoints).toHaveLength(1);
    expect(session.pauseOnExceptions).toBe('uncaught');
    expect(session.metadata).toEqual({ tag: 'unit' });
  });

  it('throws when importing session while debugger is disabled', async () => {
    const managerMock = { isEnabled: () => false } as any;
    const sessionManager = new DebuggerSessionManager(managerMock);

    await expect(
      sessionManager.importSession({
        version: '1.0',
        timestamp: Date.now(),
        breakpoints: [],
        pauseOnExceptions: 'none',
      } as any),
    ).rejects.toThrow('Debugger must be enabled');
  });

  it('imports url/script breakpoints and applies pauseOnExceptions', async () => {
    const managerMock = {
      isEnabled: vi.fn(() => true),
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setBreakpointByUrl: vi.fn().mockResolvedValue(undefined),
      setBreakpoint: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    } as any;

    const sessionManager = new DebuggerSessionManager(managerMock);
    await sessionManager.importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [
        { location: { url: 'https://a.js', lineNumber: 3 }, enabled: true },
        { location: { scriptId: 's1', lineNumber: 7 }, enabled: true },
        { location: { lineNumber: 0 }, enabled: true },
      ],
      pauseOnExceptions: 'all',
    } as any);

    expect(managerMock.clearAllBreakpoints).toHaveBeenCalledTimes(1);
    expect(managerMock.setBreakpointByUrl).toHaveBeenCalledTimes(1);
    expect(managerMock.setBreakpoint).toHaveBeenCalledTimes(1);
    expect(managerMock.setPauseOnExceptions).toHaveBeenCalledWith('all');
  });

  it('restores breakpoints concurrently within a batch', async () => {
    const pendingResolvers: Array<() => void> = [];
    const managerMock = {
      isEnabled: vi.fn(() => true),
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setBreakpointByUrl: vi.fn(
        () => new Promise<void>((resolve) => pendingResolvers.push(resolve)),
      ),
      setBreakpoint: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    } as any;

    const sessionManager = new DebuggerSessionManager(managerMock);
    const importPromise = sessionManager.importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [
        { location: { url: 'https://a.js', lineNumber: 3 }, enabled: true },
        { location: { url: 'https://b.js', lineNumber: 5 }, enabled: true },
      ],
      pauseOnExceptions: 'none',
    } as any);

    await Promise.resolve();

    expect(managerMock.setBreakpointByUrl).toHaveBeenCalledTimes(2);
    pendingResolvers.splice(0).forEach((resolve) => resolve());
    await importPromise;
  });

  it('saves session JSON to disk (default path)', async () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
    } as any;
    const sessionManager = new DebuggerSessionManager(managerMock);
    const savedPath = await sessionManager.saveSession(undefined, { source: 'test' });

    const content = await readFile(savedPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(savedPath).toContain('debugger-sessions');
    expect(parsed.metadata).toEqual({ source: 'test' });
  });

  it('rejects save paths outside the workspace or temp directory', async () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
    } as any;
    const sessionManager = new DebuggerSessionManager(managerMock);

    // Use a path that is guaranteed absolute and outside cwd/tmpdir on any OS
    await expect(sessionManager.saveSession('/forbidden/session.json')).rejects.toThrow(
      'filePath must be within the current working directory or system temp dir.',
    );
  });

  it('warns when importing a session with a version mismatch', async () => {
    const managerMock = {
      isEnabled: vi.fn(() => true),
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setBreakpointByUrl: vi.fn().mockResolvedValue(undefined),
      setBreakpoint: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    } as any;

    const sessionManager = new DebuggerSessionManager(managerMock);
    await sessionManager.importSession({
      version: '2.0',
      timestamp: Date.now(),
      breakpoints: [],
      pauseOnExceptions: 'none',
    } as any);

    expect(loggerState.warn).toHaveBeenCalledWith('Session version mismatch: 2.0 (expected 1.0)');
  });

  it('lists saved sessions sorted by descending timestamp and skips invalid files', async () => {
    const sessionsDir = join(workDir, 'debugger-sessions');
    await mkdir(sessionsDir, { recursive: true });

    await writeFile(
      join(sessionsDir, 'a.json'),
      JSON.stringify({ version: '1.0', timestamp: 1000, breakpoints: [], metadata: { id: 'a' } }),
    );
    await writeFile(
      join(sessionsDir, 'b.json'),
      JSON.stringify({ version: '1.0', timestamp: 2000, breakpoints: [], metadata: { id: 'b' } }),
    );
    await writeFile(join(sessionsDir, 'broken.json'), '{not-json');

    const managerMock = {} as any;
    const sessionManager = new DebuggerSessionManager(managerMock);
    const sessions = await sessionManager.listSavedSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.metadata?.id).toBe('b');
    expect(sessions[1]?.metadata?.id).toBe('a');
  });

  it('exportSession includes watch expressions and blackbox patterns when managers are active', () => {
    const watchManager = {
      exportWatches: vi.fn(() => [{ expression: 'a', name: 'a', enabled: true }]),
    };
    const blackboxManager = { getAllBlackboxedPatterns: vi.fn(() => ['.*jquery.*']) };
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
      getWatchManager: () => watchManager,
      getBlackboxManager: () => blackboxManager,
    } as any;

    const session = new DebuggerSessionManager(managerMock).exportSession();

    expect(session.watchExpressions).toEqual([{ expression: 'a', name: 'a', enabled: true }]);
    expect(session.blackboxPatterns).toEqual(['.*jquery.*']);
  });

  it('exportSession omits empty blackbox patterns', () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
      getWatchManager: () => ({ exportWatches: () => [] }),
      getBlackboxManager: () => ({ getAllBlackboxedPatterns: () => [] }),
    } as any;

    const session = new DebuggerSessionManager(managerMock).exportSession();

    expect(session.watchExpressions).toEqual([]);
    expect(session.blackboxPatterns).toBeUndefined();
  });

  it('exportSession omits watch/blackbox when advanced managers are not initialized', () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
      getWatchManager: () => {
        throw new Error('WatchExpressionManager not initialized');
      },
      getBlackboxManager: () => {
        throw new Error('BlackboxManager not initialized');
      },
    } as any;

    const session = new DebuggerSessionManager(managerMock).exportSession();

    expect(session.watchExpressions).toBeUndefined();
    expect(session.blackboxPatterns).toBeUndefined();
  });

  it('importSession restores watch expressions and blackbox patterns', async () => {
    const importWatches = vi.fn();
    const restorePatterns = vi.fn().mockResolvedValue(undefined);
    const managerMock = {
      isEnabled: vi.fn(() => true),
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
      getWatchManager: () => ({ importWatches }),
      getBlackboxManager: () => ({ restorePatterns }),
    } as any;

    await new DebuggerSessionManager(managerMock).importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [],
      pauseOnExceptions: 'none',
      watchExpressions: [{ expression: 'x', name: 'x', enabled: true }],
      blackboxPatterns: ['.*react.*'],
    } as any);

    expect(importWatches).toHaveBeenCalledWith([{ expression: 'x', name: 'x', enabled: true }]);
    expect(restorePatterns).toHaveBeenCalledWith(['.*react.*']);
  });

  it('importSession backward-compat: sessions without watch/blackbox fields restore nothing extra', async () => {
    const importWatches = vi.fn();
    const restorePatterns = vi.fn().mockResolvedValue(undefined);
    const managerMock = {
      isEnabled: vi.fn(() => true),
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
      getWatchManager: () => ({ importWatches }),
      getBlackboxManager: () => ({ restorePatterns }),
    } as any;

    await new DebuggerSessionManager(managerMock).importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [],
      pauseOnExceptions: 'none',
    } as any);

    expect(importWatches).not.toHaveBeenCalled();
    expect(restorePatterns).not.toHaveBeenCalled();
  });

  it('importSession fail-soft: blackbox restore failure does not reject', async () => {
    const restorePatterns = vi.fn().mockRejectedValue(new Error('cdp down'));
    const managerMock = {
      isEnabled: vi.fn(() => true),
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
      getBlackboxManager: () => ({ restorePatterns }),
    } as any;

    await expect(
      new DebuggerSessionManager(managerMock).importSession({
        version: '1.0',
        timestamp: Date.now(),
        breakpoints: [],
        pauseOnExceptions: 'all',
        blackboxPatterns: ['.*x.*'],
      } as any),
    ).resolves.toBeUndefined();

    expect(loggerState.warn).toHaveBeenCalledWith(
      'Failed to restore blackbox patterns:',
      expect.any(Error),
    );
  });
});
