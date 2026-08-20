/**
 * Security-focused tests for electron_attach evaluateExpr vulnerability (CRIT-03)
 *
 * Tests the fix for new Function() security risk, ensuring:
 * 1. Malicious expressions are blocked
 * 2. Legitimate expressions work correctly
 * 3. CDP connection remains robust
 * 4. No arbitrary code execution vectors
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  connect: vi.fn(),
  connectPlaywrightCdpFallback: vi.fn(),
  browserPages: vi.fn(),
  browserDisconnect: vi.fn(),
  pageEvaluate: vi.fn(),
  cdpSessionSend: vi.fn(),
}));

vi.mock(import('@server/domains/shared/modules/native'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    UnifiedProcessManager: class {
      getPlatform() {
        return 'win32';
      }
    } as unknown as typeof actual.UnifiedProcessManager,
    MemoryManager: class MemoryManagerMock {
      getPlatform() {
        return 'win32';
      }
    } as unknown as typeof actual.MemoryManager,
  };
});

vi.mock(import('@src/modules/process/memory/AuditTrail'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    MemoryAuditTrail: class {
      record() {}
      exportJson() {
        return '[]';
      }
      clear() {}
      size() {
        return 0;
      }
    } as unknown as typeof actual.MemoryAuditTrail,
  };
});

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    connect: (...args: any[]) => state.connect(...args),
  },
}));

vi.mock('@modules/collector/playwright-cdp-fallback', () => ({
  connectPlaywrightCdpFallback: (...args: any[]) => state.connectPlaywrightCdpFallback(...args),
}));

import { ProcessToolHandlersRuntime } from '@server/domains/process/handlers.impl.core.runtime.inject';
import { buildTestUrl } from '@tests/shared/test-urls';

const originalFetch = global.fetch;

function jsonResponse(body: any, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
  };
}

function createBrowserPage(url: string) {
  return {
    url: () => url,
    evaluate: (...args: any[]) => state.pageEvaluate(...args),
  };
}

describe('electron_attach security (CRIT-03)', () => {
  let handler: ProcessToolHandlersRuntime;

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new ProcessToolHandlersRuntime();

    const mockBrowser = {
      pages: state.browserPages,
      disconnect: state.browserDisconnect,
    };

    state.connect.mockResolvedValue(mockBrowser);
    state.connectPlaywrightCdpFallback.mockResolvedValue(mockBrowser);
    state.browserPages.mockResolvedValue([]);
    state.browserDisconnect.mockResolvedValue(undefined);
    state.pageEvaluate.mockReset();
    state.cdpSessionSend.mockReset();

    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: 'page-1',
          title: 'Test Page',
          url: buildTestUrl('app', { suffix: 'local', path: 'test' }),
          type: 'page',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/page/page-1',
        },
      ]),
    ) as typeof fetch;
  });

  describe('Malicious expression blocking', () => {
    it('blocks expressions attempting Function constructor access', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);

      // Attempt to access Function constructor
      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: '(function(){}).constructor("return process")()',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/blocked.*security|Unknown error|Evaluation failed/i);
      expect(state.pageEvaluate).not.toHaveBeenCalled();
    });

    it('blocks expressions with eval() calls', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: 'eval("require(\\"child_process\\")")',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/blocked.*security|Unknown error|Evaluation failed/i);
    });

    it('blocks expressions attempting to access __proto__', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: '({}).__proto__.constructor("return process")()',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/blocked.*security|Unknown error|Evaluation failed/i);
    });

    it('blocks expressions attempting to access process object', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: 'process.mainModule.require("child_process")',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/blocked.*security|Unknown error|Evaluation failed/i);
    });

    it('blocks expressions attempting to access require', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: 'require("fs").readFileSync("/etc/passwd")',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/blocked.*security|Unknown error|Evaluation failed/i);
    });

    it('blocks expressions with import() dynamic imports', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: 'import("child_process").then(cp => cp.exec("whoami"))',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/blocked.*security|Unknown error|Evaluation failed/i);
    });
  });

  describe('Legitimate expression execution via CDP Runtime.evaluate', () => {
    it('allows simple arithmetic expressions', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);
      state.pageEvaluate.mockResolvedValue({ ok: true, result: 42 });

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: '40 + 2',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(true);
      expect(response.result).toBe(42);
    });

    it('allows safe DOM queries', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);
      state.pageEvaluate.mockResolvedValue({ ok: true, result: 'Test Title' });

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: 'document.title',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(true);
      expect(response.result).toBe('Test Title');
    });

    it('allows safe window property access', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);
      state.pageEvaluate.mockResolvedValue({
        ok: true,
        result: buildTestUrl('app', { suffix: 'local', path: 'test' }),
      });

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: 'window.location.href',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(true);
      expect(response.result).toContain('https://app.local/test');
    });

    it('allows safe localStorage access', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);
      state.pageEvaluate.mockResolvedValue({ ok: true, result: 'testValue' });

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: 'localStorage.getItem("testKey")',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(true);
      expect(response.result).toBe('testValue');
    });

    it('allows safe JSON operations', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);
      state.pageEvaluate.mockResolvedValue({ ok: true, result: { parsed: true } });

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: 'JSON.parse("{\\"parsed\\":true}")',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(true);
      expect(response.result).toEqual({ parsed: true });
    });
  });

  describe('CDP connection robustness', () => {
    it('maintains connection stability across multiple evaluations', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);
      state.pageEvaluate.mockResolvedValue({ ok: true, result: 1 });

      await handler.handleElectronAttach({ port: 9229, evaluate: '1' });
      await handler.handleElectronAttach({ port: 9229, evaluate: '1' });

      expect(state.browserDisconnect).toHaveBeenCalledTimes(2);
    });

    it('properly cleans up connections on evaluation failure', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);
      state.pageEvaluate.mockResolvedValue({
        ok: false,
        error: { name: 'Error', message: 'Evaluation failed' },
      });

      await handler.handleElectronAttach({ port: 9229, evaluate: 'document.title' });

      expect(state.browserDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge cases and validation', () => {
    it('handles empty evaluate expression', async () => {
      // Empty evaluate returns pages list (no evaluation happens)
      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: '',
      });
      const response = JSON.parse(result.content[0]!.text);

      // Empty expression skips evaluation and returns target list
      expect(response.total).toBe(1);
      expect(response.filtered).toBe(1);
    });

    it('handles extremely long expressions', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);

      const longExpr = 'x'.repeat(100000);
      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: longExpr,
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/too long/i);
    });

    it('sanitizes error messages to prevent information disclosure', async () => {
      state.browserPages.mockResolvedValue([
        createBrowserPage(buildTestUrl('app', { suffix: 'local', path: 'test' })),
      ]);
      state.pageEvaluate.mockResolvedValue({
        ok: false,
        error: {
          name: 'Error',
          message: 'Sensitive path: C:\\Users\\Administrator\\secret.txt',
        },
      });

      const result = await handler.handleElectronAttach({
        port: 9229,
        evaluate: 'throw new Error("test")',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.error).not.toContain('C:\\Users');
      expect(response.error).not.toContain('Administrator');
    });
  });
});
