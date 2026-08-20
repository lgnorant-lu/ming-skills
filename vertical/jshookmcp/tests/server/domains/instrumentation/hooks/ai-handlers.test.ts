import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AIHookToolHandlers,
  toCsvRows,
} from '../../../../../src/server/domains/instrumentation/hooks/ai-handlers';
import type { PageController } from '../../../../../src/server/domains/shared/modules/collector';
import {
  evaluateWithTimeout,
  evaluateOnNewDocumentWithTimeout,
} from '../../../../../src/modules/collector/PageController';

vi.mock('../../../../../src/modules/collector/PageController', () => ({
  evaluateWithTimeout: vi.fn(),
  evaluateOnNewDocumentWithTimeout: vi.fn(),
}));

vi.mock('../../../../../src/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe('AIHookToolHandlers', () => {
  let pageControllerMock: PageController & {
    getPage: ReturnType<typeof vi.fn>;
    hasAttachedTargetSession: ReturnType<typeof vi.fn>;
    evaluateAttachedTarget: ReturnType<typeof vi.fn>;
    addScriptToAttachedTarget: ReturnType<typeof vi.fn>;
    addPersistentScriptToManagedTargets: ReturnType<typeof vi.fn>;
    addScriptToPageEvaluateOnNewDocument: ReturnType<typeof vi.fn>;
  };
  let pageMock: any;
  let handlers: AIHookToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageMock = {};
    pageControllerMock = {
      getPage: vi.fn().mockResolvedValue(pageMock),
      hasAttachedTargetSession: vi.fn().mockReturnValue(false),
      evaluateAttachedTarget: vi.fn(),
      addScriptToAttachedTarget: vi.fn(),
      addPersistentScriptToManagedTargets: vi.fn().mockResolvedValue({
        identifier: 'ai-hook:test',
        appliedTargets: 1,
      }),
      addScriptToPageEvaluateOnNewDocument: vi
        .fn()
        .mockResolvedValue({ identifier: 'page-script' }),
    } as any;
    handlers = new AIHookToolHandlers(pageControllerMock);
  });

  describe('handleAIHookInject', () => {
    it('injects via evaluate by default without explicit method', async () => {
      const res = await handlers.handleAIHookInject({ hookId: 'test1', code: 'alert(1)' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');
      expect(evaluateWithTimeout).toHaveBeenCalled();
    });

    it('injects via evaluateOnNewDocument when defined in method', async () => {
      const res = await handlers.handleAIHookInject({
        hookId: 'test2',
        code: 'alert(1)',
        method: 'evaluateOnNewDocument',
      });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');
      expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalled();
    });

    it('handles missing required arguments gracefully', async () => {
      const res = await handlers.handleAIHookInject({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
      // @ts-expect-error
      expect(res.content[0].text).toContain('hookId');
    });

    it('throws appropriately on injection crash from execution context', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('inject fail'));
      const res = await handlers.handleAIHookInject({ hookId: 'test1', code: 'alert(1)' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
      // @ts-expect-error
      expect(res.content[0].text).toContain('inject fail');
    });

    it('throws appropriately on injection string crash from execution context', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('inject string fail');
      const res = await handlers.handleAIHookInject({ hookId: 'test1', code: 'alert(1)' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
      // @ts-expect-error
      expect(res.content[0].text).toContain('inject string fail');
    });

    it('injects into attached CDP target when an active target session exists', async () => {
      pageControllerMock.hasAttachedTargetSession.mockReturnValue(true);
      pageControllerMock.evaluateAttachedTarget.mockResolvedValue(undefined);

      const res = await handlers.handleAIHookInject({ hookId: 'target1', code: 'globalThis.a=1' });

      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');
      expect(pageControllerMock.evaluateAttachedTarget).toHaveBeenCalledWith('globalThis.a=1', {
        returnByValue: true,
        awaitPromise: true,
      });
      expect(pageControllerMock.getPage).not.toHaveBeenCalled();
    });

    it('injects evaluateOnNewDocument into both page preload and managed targets when attached', async () => {
      pageControllerMock.hasAttachedTargetSession.mockReturnValue(true);

      const res = await handlers.handleAIHookInject({
        hookId: 'target-persistent',
        code: 'globalThis.__probe = true',
        method: 'evaluateOnNewDocument',
      });

      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');
      expect(pageControllerMock.addScriptToPageEvaluateOnNewDocument).toHaveBeenCalledWith(
        'globalThis.__probe = true',
        {
          id: 'ai-hook:target-persistent',
        },
      );
      expect(pageControllerMock.addPersistentScriptToManagedTargets).toHaveBeenCalledWith(
        'globalThis.__probe = true',
        {
          id: 'ai-hook:target-persistent',
          evaluateNow: true,
          targetTypes: ['page', 'iframe'],
        },
      );
    });
  });

  describe('handleAIHookGetData', () => {
    it('retrieves accurate hook data map if present in target context', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({ hookId: 'test1', totalRecords: 5 });
      const res = await handlers.handleAIHookGetData({ hookId: 'test1' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');
      // @ts-expect-error
      expect(res.content[0].text).toContain('"totalRecords": 5');

      // Execute callback for coverage
      // @ts-expect-error
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;

      // 1. Missing hook
      (global as any).window = {};
      expect(fn('test1')).toBeNull();

      // 2. Present hook
      (global as any).window = { __aiHooks: { test1: [{}] }, __aiHookMetadata: { test1: {} } };
      expect(fn('test1').totalRecords).toBe(1);
    });

    it('returns false payload representation if hook completely missing', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue(null);
      const res = await handlers.handleAIHookGetData({ hookId: 'test_miss' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles crash trace error', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookGetData({ hookId: 'test1' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles string trace error', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookGetData({ hookId: 'test1' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
    });

    it('reads hook data from attached CDP target', async () => {
      pageControllerMock.hasAttachedTargetSession.mockReturnValue(true);
      pageControllerMock.evaluateAttachedTarget.mockResolvedValue({
        hookId: 'target1',
        totalRecords: 2,
      });

      const res = await handlers.handleAIHookGetData({ hookId: 'target1' });

      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');
      // @ts-expect-error
      expect(res.content[0].text).toContain('"totalRecords": 2');
      expect(pageControllerMock.evaluateAttachedTarget).toHaveBeenCalledOnce();
      expect(pageControllerMock.getPage).not.toHaveBeenCalled();
    });
  });

  describe('handleAIHookList', () => {
    it('lists hooks present as array structure', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue([{ hookId: 'test1' }]);
      const res = await handlers.handleAIHookList({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');
      // @ts-expect-error
      expect(res.content[0].text).toContain('"totalHooks": 1');

      // Execute callback for coverage
      // @ts-expect-error
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = {};
      expect(fn()).toEqual([]);

      (global as any).window = { __aiHookMetadata: { test1: {} }, __aiHooks: { test1: [{}] } };
      expect(fn()[0].recordCount).toBe(1);

      (global as any).window = { __aiHookMetadata: { test1: {} }, __aiHooks: {} };
      expect(fn()[0].recordCount).toBe(0);
    });

    it('handles generic internal errors gracefully outside hook mappings', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookList({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
      // @ts-expect-error
      expect(res.content[0].text).toContain('err');
    });

    it('handles string based error traces accurately for internal catch', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookList({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
      // @ts-expect-error
      expect(res.content[0].text).toContain('string error');
    });
  });

  describe('handleAIHookClear', () => {
    it('clears specific hook if hookId passed specifically', async () => {
      const res = await handlers.handleAIHookClear({ hookId: 'test1' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');

      // Execute callback for coverage
      // @ts-expect-error
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHooks: { test1: [1, 2, 3] } };
      fn('test1');
      expect((global as any).window.__aiHooks.test1).toEqual([]);

      // Non-existent hook coverage branch
      (global as any).window = {};
      fn('test2'); // Should not throw
    });

    it('clears all hooks across broad context boundaries', async () => {
      const res = await handlers.handleAIHookClear({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');

      // Execute callback for coverage
      // @ts-expect-error
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHooks: { test1: [1], test2: [2] } };
      fn();
      expect((global as any).window.__aiHooks.test1).toEqual([]);

      (global as any).window = {};
      fn(); // Should not throw
    });

    it('handles error traces accurately for internal catch', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookClear({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles string traces accurately for internal catch', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookClear({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
    });
  });

  describe('handleAIHookToggle', () => {
    it('toggles a singular specific hook successfully evaluating page switch', async () => {
      const res = await handlers.handleAIHookToggle({ hookId: 'test1', enabled: true });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');
      expect(evaluateWithTimeout).toHaveBeenCalled();

      // Execute callback for coverage
      // @ts-expect-error
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHookMetadata: { test1: { enabled: false } } };
      fn('test1', true);
      expect((global as any).window.__aiHookMetadata.test1.enabled).toBe(true);

      (global as any).window = {};
      fn('test1', true); // Should not throw
    });

    it('toggles hook specifically evaluating page switch to off', async () => {
      const res = await handlers.handleAIHookToggle({ hookId: 'test1', enabled: false });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');
    });

    it('reports the resulting enabled state in the message', async () => {
      const on = await handlers.handleAIHookToggle({ hookId: 'test1', enabled: true });
      // @ts-expect-error
      expect(JSON.parse(on.content[0].text).message).toBe('Hook enabled');
      const off = await handlers.handleAIHookToggle({ hookId: 'test1', enabled: false });
      // @ts-expect-error
      expect(JSON.parse(off.content[0].text).message).toBe('Hook disabled');
    });

    it('handles error bounds catch on evaluating page switch', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookToggle({ hookId: 'test1' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles string limits safely', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookToggle({ hookId: 'test1' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
    });
  });

  describe('handleAIHookExport', () => {
    it('exports a specific hook from defined context evaluation boundary', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({ hookId: 'test1' });
      const res = await handlers.handleAIHookExport({ hookId: 'test1' });
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');

      // Execute callback for coverage
      // @ts-expect-error
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHookMetadata: { test1: {} }, __aiHooks: { test1: [{}] } };
      const exp1 = fn('test1');
      expect(exp1.records.length).toBe(1);

      (global as any).window = {};
      const expMissing = fn('test1');
      expect(expMissing.records).toEqual([]);
    });

    it('exports all hooks when no identity limits restrict search bound', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({ metadata: {} });
      const res = await handlers.handleAIHookExport({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": true');

      // Execute callback for coverage
      // @ts-expect-error
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHookMetadata: { test1: {} }, __aiHooks: { test1: [{}] } };
      const expAll = fn();
      expect(expAll.records.test1.length).toBe(1);

      (global as any).window = {};
      const expMissing = fn();
      expect(expMissing.records).toEqual({});
    });

    it('safely handles error maps', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookExport({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
    });

    it('safely handles string error maps', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookExport({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('"success": false');
    });

    it('renders csv output for a single hook when format=csv', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({
        hookId: 'test1',
        records: [
          { ts: 1, url: 'a?x=1', stack: ['f1', 'f2'] },
          { ts: 2, url: 'b', stack: [] },
        ],
      });
      const res = await handlers.handleAIHookExport({ hookId: 'test1', format: 'csv' });
      // @ts-expect-error
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.format).toBe('csv');
      const csv = parsed.data as string;
      expect(csv.split('\n')[0]).toBe('ts,url,stack');
      expect(csv).toContain('"1","a?x=1"');
      expect(csv).toContain('"2","b"');
      // JSON cell values are escaped with doubled quotes
      expect(csv).toContain('"[""f1"",""f2""]"');
    });

    it('renders csv output for all hooks with a hookId column when format=csv', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({
        metadata: {},
        records: { h1: [{ ts: 1 }], h2: [{ ts: 2 }] },
      });
      const res = await handlers.handleAIHookExport({ format: 'csv' });
      // @ts-expect-error
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.format).toBe('csv');
      const csv = parsed.data as string;
      expect(csv.split('\n')[0]).toBe('hookId,ts');
      expect(csv).toContain('"h1","1"');
      expect(csv).toContain('"h2","2"');
    });

    it('keeps raw json object shape when format=json', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({
        hookId: 'test1',
        records: [{ ts: 1 }],
      });
      const res = await handlers.handleAIHookExport({ hookId: 'test1', format: 'json' });
      // @ts-expect-error
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.format).toBe('json');
      expect(parsed.data).toEqual({ hookId: 'test1', records: [{ ts: 1 }] });
    });
  });

  describe('toCsvRows', () => {
    it('returns empty string for empty or malformed input', () => {
      expect(toCsvRows([])).toBe('');
      expect(toCsvRows({})).toBe('');
      expect(toCsvRows({ h1: 'not-an-array' } as unknown as Record<string, never[]>)).toBe('');
    });

    it('escapes embedded quotes per RFC 4180', () => {
      const csv = toCsvRows([{ msg: 'say "hi"' }]);
      expect(csv).toContain('"say ""hi"""');
    });
  });
});
