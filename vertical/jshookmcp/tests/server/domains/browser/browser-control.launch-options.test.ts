import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPageMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserLaunchResponse } from '@tests/shared/common-test-types';

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { BrowserControlHandlers } from '@server/domains/browser/handlers/browser-control';

interface CollectorMock {
  launch: Mock<(args: any) => Promise<any>>;
  getStatus: Mock<() => Promise<{ connected: boolean; pages?: number }>>;
  listPages: Mock<() => Promise<Array<{ index: number; url: string; title: string }>>>;
  selectPage: Mock<(index: number) => Promise<void>>;
}

function createHandlers() {
  const collector: CollectorMock = {
    launch: vi.fn(async () => ({
      action: 'relaunched',
      reason: 'launch-options-changed',
      launchOptions: {
        headless: false,
        args: ['--site-per-process', '--js-flags=--allow-natives-syntax'],
        v8NativeSyntaxEnabled: true,
      },
    })),
    getStatus: vi.fn(async () => ({ connected: true, pages: 1 })),
    listPages: vi.fn(async () => [{ index: 0, url: 'about:blank', title: '' }]),
    selectPage: vi.fn(async () => {}),
  };

  const handlers = new BrowserControlHandlers({
    collector: collector as any,
    pageController: createPageMock() as any,
    consoleMonitor: { markContextChanged: vi.fn() } as any,
    getActiveDriver: () => 'chrome',
    getCamoufoxManager: () => null,
    getCamoufoxPage: async () => null,
    getTabRegistry: () =>
      ({
        reconcilePages: vi.fn(),
        setCurrentByIndex: vi.fn(),
        getTabByIndex: vi.fn(),
        getContextMeta: vi.fn(),
      }) as any,
    clearAttachedTargetContext: vi.fn(async () => ({
      detached: false,
      targetId: null,
      type: null,
    })),
  });

  return { collector, handlers };
}

describe('BrowserControlHandlers launch options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes explicit args and V8 native syntax flag to collector.launch', async () => {
    const { collector, handlers } = createHandlers();

    const body = parseJson<BrowserLaunchResponse & Record<string, unknown>>(
      await handlers.handleBrowserLaunch({
        headless: false,
        args: ['--site-per-process', '--js-flags=--trace-opt'],
        enableV8NativesSyntax: true,
      }),
    );

    expect(collector.launch).toHaveBeenCalledWith({
      headless: false,
      args: ['--site-per-process', '--js-flags=--trace-opt'],
      enableV8NativesSyntax: true,
    });
    expect(collector.listPages).toHaveBeenCalled();
    expect(collector.selectPage).toHaveBeenCalledWith(0);
    expect(body.success).toBe(true);
    expect(body['launchAction']).toBe('relaunched');
    expect(body['relaunchReason']).toBe('launch-options-changed');
    expect(body['v8NativeSyntaxEnabled']).toBe(true);
    expect(body['launchArgs']).toEqual(['--site-per-process', '--js-flags=--allow-natives-syntax']);
    expect(body['selectedIndex']).toBe(0);
    expect(body['currentUrl']).toBe('about:blank');
    expect(body['totalPages']).toBe(1);
  });

  it('appends --ssl-key-log to launch args when sslKeyLogFile is set', async () => {
    const { collector, handlers } = createHandlers();
    await handlers.handleBrowserLaunch({
      headless: false,
      args: [],
      sslKeyLogFile: '/tmp/keys.log',
      enableV8NativesSyntax: true,
    });
    expect(collector.launch).toHaveBeenCalledWith({
      headless: false,
      args: ['--ssl-key-log=/tmp/keys.log'],
      enableV8NativesSyntax: true,
    });
  });

  it('merges sslKeyLogFile with existing args', async () => {
    const { collector, handlers } = createHandlers();
    await handlers.handleBrowserLaunch({
      headless: false,
      args: ['--disable-features=Foo'],
      sslKeyLogFile: '/tmp/keys.log',
      enableV8NativesSyntax: false,
    });
    expect(collector.launch).toHaveBeenCalledWith({
      headless: false,
      args: ['--disable-features=Foo', '--ssl-key-log=/tmp/keys.log'],
      enableV8NativesSyntax: false,
    });
  });
});
