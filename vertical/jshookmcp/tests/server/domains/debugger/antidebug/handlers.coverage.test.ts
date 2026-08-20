/**
 * Coverage tests for AntiDebugToolHandlers — selective bypass types,
 * parseDebuggerMode branches, mergeStackFilterPatterns dedup/trim,
 * buildScript token replacement, injectScripts persistent/non-persistent paths.
 *
 * The existing handlers.test.ts covers the individual bypass/detect handlers
 * but does NOT cover handleAntidebugBypass (the selective-type dispatcher)
 * nor all branches of parseDebuggerMode and mergeStackFilterPatterns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AntiDebugToolHandlers } from '../../../../../src/server/domains/debugger/antidebug/handlers';
import type { CodeCollector } from '../../../../../src/server/domains/shared/modules/collector';
import {
  evaluateWithTimeout,
  evaluateOnNewDocumentWithTimeout,
} from '../../../../../src/modules/collector/PageController';

vi.mock('../../../../../src/modules/collector/PageController', () => ({
  evaluateWithTimeout: vi.fn(),
  evaluateOnNewDocumentWithTimeout: vi.fn(),
}));

/**
 * Parse the JSON payload from a handleSafe-wrapped tool response.
 */
function parsePayload(res: {
  content: Array<{ type: string; text: string }>;
}): Record<string, unknown> {
  return JSON.parse(res.content[0]!.text);
}

describe('AntiDebugToolHandlers — handleAntidebugBypass selective types', () => {
  // @ts-expect-error
  let collectorMock: vi.Mocked<CodeCollector>;
  let pageMock: any;
  let handlers: AntiDebugToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageMock = {};
    collectorMock = {
      getActivePage: vi.fn().mockResolvedValue(pageMock),
    } as any;
    handlers = new AntiDebugToolHandlers(collectorMock);
  });

  // ── types=['all'] delegates to handleAntiDebugBypassAll ────────────────

  describe('types includes all', () => {
    it('delegates to bypassAll when types=["all"]', async () => {
      const res = await handlers.handleAntidebugBypass({ types: ['all'] });
      const payload = parsePayload(res as any);
      expect(payload.success).toBe(true);
      expect(payload.tool).toBe('antidebug_bypass_all');
      expect(payload.injectedCount).toBe(4);
    });

    it('delegates to bypassAll when types is empty array (falls back to ["all"])', async () => {
      const res = await handlers.handleAntidebugBypass({ types: [] });
      const payload = parsePayload(res as any);
      expect(payload.tool).toBe('antidebug_bypass_all');
    });

    it('delegates to bypassAll when types is not an array', async () => {
      const res = await handlers.handleAntidebugBypass({ types: 'all' });
      const payload = parsePayload(res as any);
      expect(payload.tool).toBe('antidebug_bypass_all');
    });

    it('delegates to bypassAll when types key is missing', async () => {
      const res = await handlers.handleAntidebugBypass({});
      const payload = parsePayload(res as any);
      expect(payload.tool).toBe('antidebug_bypass_all');
    });
  });

  // ── selective types: debugger_statement ────────────────────────────────

  describe('types=["debugger_statement"]', () => {
    it('applies only debugger_statement bypass', async () => {
      const res = await handlers.handleAntidebugBypass({ types: ['debugger_statement'] });
      const payload = parsePayload(res as any);
      expect(payload.success).toBe(true);
      expect(payload.applied).toEqual(['debugger_statement']);
      // Only evaluateOnNewDocument (persistent=true default) + evaluate for one script
      expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalledTimes(1);
    });

    it('uses remove mode by default', async () => {
      await handlers.handleAntidebugBypass({ types: ['debugger_statement'] });
      const scriptArg = vi.mocked(evaluateOnNewDocumentWithTimeout).mock.calls[0]![1] as string;
      expect(scriptArg).toContain('"remove"');
    });

    it('uses noop mode when specified', async () => {
      await handlers.handleAntidebugBypass({ types: ['debugger_statement'], mode: 'noop' });
      const scriptArg = vi.mocked(evaluateOnNewDocumentWithTimeout).mock.calls[0]![1] as string;
      expect(scriptArg).toContain('"noop"');
    });
  });

  // ── selective types: timing ────────────────────────────────────────────

  describe('types=["timing"]', () => {
    it('applies only timing bypass', async () => {
      const res = await handlers.handleAntidebugBypass({ types: ['timing'] });
      const payload = parsePayload(res as any);
      expect(payload.applied).toEqual(['timing']);
    });

    it('uses custom maxDrift', async () => {
      await handlers.handleAntidebugBypass({ types: ['timing'], maxDrift: 200 });
      const scriptArg = vi.mocked(evaluateOnNewDocumentWithTimeout).mock.calls[0]![1] as string;
      expect(scriptArg).toContain('200');
    });
  });

  // ── selective types: stack_trace ────────────────────────────────────────

  describe('types=["stack_trace"]', () => {
    it('applies only stack_trace bypass', async () => {
      const res = await handlers.handleAntidebugBypass({ types: ['stack_trace'] });
      const payload = parsePayload(res as any);
      expect(payload.applied).toEqual(['stack_trace']);
    });

    it('merges user filter patterns', async () => {
      await handlers.handleAntidebugBypass({
        types: ['stack_trace'],
        filterPatterns: ['myapp', '  ', 'puppeteer'],
      });
      const scriptArg = vi.mocked(evaluateOnNewDocumentWithTimeout).mock.calls[0]![1] as string;
      // 'puppeteer' should be deduplicated (already in defaults)
      // Empty strings should be filtered out
      expect(scriptArg).toContain('myapp');
    });
  });

  // ── selective types: console_detect ────────────────────────────────────

  describe('types=["console_detect"]', () => {
    it('applies only console_detect bypass', async () => {
      const res = await handlers.handleAntidebugBypass({ types: ['console_detect'] });
      const payload = parsePayload(res as any);
      expect(payload.applied).toEqual(['console_detect']);
    });
  });

  // ── multiple selective types ───────────────────────────────────────────

  describe('types=["debugger_statement","timing"]', () => {
    it('applies both bypass types', async () => {
      const res = await handlers.handleAntidebugBypass({
        types: ['debugger_statement', 'timing'],
      });
      const payload = parsePayload(res as any);
      expect(payload.applied).toEqual(['debugger_statement', 'timing']);
    });
  });

  // ── persistent flag in selective mode ──────────────────────────────────

  describe('persistent flag in selective mode', () => {
    it('persistent=false skips evaluateOnNewDocument', async () => {
      await handlers.handleAntidebugBypass({
        types: ['debugger_statement'],
        persistent: false,
      });
      expect(evaluateOnNewDocumentWithTimeout).not.toHaveBeenCalled();
      expect(evaluateWithTimeout).toHaveBeenCalled();
    });

    it('persistent=true calls both evaluateOnNewDocument and evaluate', async () => {
      await handlers.handleAntidebugBypass({
        types: ['timing'],
        persistent: true,
      });
      expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalled();
      expect(evaluateWithTimeout).toHaveBeenCalled();
    });
  });

  // ── injection error in selective mode ──────────────────────────────────

  describe('error handling in selective mode', () => {
    it('catches injection errors gracefully', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('inject fail'));
      const res = await handlers.handleAntidebugBypass({ types: ['debugger_statement'] });
      const payload = parsePayload(res as any);
      expect(payload.success).toBe(false);
    });
  });
});

describe('AntiDebugToolHandlers — parseDebuggerMode branches', () => {
  // @ts-expect-error
  let collectorMock: vi.Mocked<CodeCollector>;
  let handlers: AntiDebugToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    collectorMock = { getActivePage: vi.fn() } as any;
    handlers = new AntiDebugToolHandlers(collectorMock);
  });

  it('accepts exact "remove" value', async () => {
    const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'remove' });
    const payload = parsePayload(res as any);
    expect(payload.mode).toBe('remove');
  });

  it('accepts exact "noop" value', async () => {
    const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'noop' });
    const payload = parsePayload(res as any);
    expect(payload.mode).toBe('noop');
  });

  it('accepts whitespace-and-case-normalized "  Remove  " as "remove"', async () => {
    const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: '  Remove  ' });
    const payload = parsePayload(res as any);
    expect(payload.mode).toBe('remove');
  });

  it('accepts whitespace-and-case-normalized "  NOOP  " as "noop"', async () => {
    const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: '  NOOP  ' });
    const payload = parsePayload(res as any);
    expect(payload.mode).toBe('noop');
  });

  it('returns default "remove" for unrecognized string', async () => {
    const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'unknown-mode' });
    const payload = parsePayload(res as any);
    expect(payload.mode).toBe('remove');
  });

  it('returns default "remove" for non-string input (number)', async () => {
    const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 42 });
    const payload = parsePayload(res as any);
    expect(payload.mode).toBe('remove');
  });

  it('returns default "remove" for object input', async () => {
    const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: { foo: 1 } });
    const payload = parsePayload(res as any);
    expect(payload.mode).toBe('remove');
  });

  it('returns default "remove" for undefined mode', async () => {
    const res = await handlers.handleAntiDebugBypassDebuggerStatement({});
    const payload = parsePayload(res as any);
    expect(payload.mode).toBe('remove');
  });
});

describe('AntiDebugToolHandlers — mergeStackFilterPatterns dedup/trim', () => {
  // @ts-expect-error
  let collectorMock: vi.Mocked<CodeCollector>;
  let handlers: AntiDebugToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    collectorMock = { getActivePage: vi.fn() } as any;
    handlers = new AntiDebugToolHandlers(collectorMock);
  });

  it('deduplicates overlapping patterns with defaults', async () => {
    // 'puppeteer' and 'CDP' are in defaults; 'myapp' is new
    const res = await handlers.handleAntiDebugBypassStackTrace({
      filterPatterns: ['myapp', 'puppeteer', 'CDP'],
    });
    const payload = parsePayload(res as any);
    const patterns = payload.filterPatterns as string[];
    // 'puppeteer' should appear only once
    expect(patterns.filter((p: string) => p === 'puppeteer').length).toBe(1);
    expect(patterns).toContain('myapp');
  });

  it('filters out empty and whitespace-only patterns', async () => {
    const res = await handlers.handleAntiDebugBypassStackTrace({
      filterPatterns: ['valid', '', '  ', 'also-valid'],
    });
    const payload = parsePayload(res as any);
    const patterns = payload.filterPatterns as string[];
    expect(patterns).toContain('valid');
    expect(patterns).toContain('also-valid');
    expect(patterns).not.toContain('');
    expect(patterns).not.toContain('  ');
  });

  it('trims whitespace from patterns', async () => {
    const res = await handlers.handleAntiDebugBypassStackTrace({
      filterPatterns: ['  spaced  '],
    });
    const payload = parsePayload(res as any);
    const patterns = payload.filterPatterns as string[];
    expect(patterns).toContain('spaced');
    expect(patterns).not.toContain('  spaced  ');
  });

  it('returns defaults when no extra patterns provided', async () => {
    const res = await handlers.handleAntiDebugBypassStackTrace({});
    const payload = parsePayload(res as any);
    const patterns = payload.filterPatterns as string[];
    expect(patterns).toContain('puppeteer');
    expect(patterns).toContain('devtools');
  });
});

describe('AntiDebugToolHandlers — buildScript token replacement', () => {
  // @ts-expect-error
  let collectorMock: vi.Mocked<CodeCollector>;
  let handlers: AntiDebugToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    collectorMock = { getActivePage: vi.fn() } as any;
    handlers = new AntiDebugToolHandlers(collectorMock);
  });

  it('replaces __ANTI_DEBUG_MAX_DRIFT__ in timing script', async () => {
    await handlers.handleAntiDebugBypassTiming({ maxDrift: 999 });
    const scriptArg = vi.mocked(evaluateOnNewDocumentWithTimeout).mock.calls[0]![1] as string;
    expect(scriptArg).not.toContain('__ANTI_DEBUG_MAX_DRIFT__');
    expect(scriptArg).toContain('999');
  });

  it('replaces __ANTI_DEBUG_MODE__ in debugger bypass script', async () => {
    await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'noop' });
    const scriptArg = vi.mocked(evaluateOnNewDocumentWithTimeout).mock.calls[0]![1] as string;
    expect(scriptArg).not.toContain('__ANTI_DEBUG_MODE__');
    expect(scriptArg).toContain('"noop"');
  });

  it('replaces __ANTI_DEBUG_FILTER_PATTERNS__ in stack trace script', async () => {
    await handlers.handleAntiDebugBypassStackTrace({ filterPatterns: ['custom'] });
    const scriptArg = vi.mocked(evaluateOnNewDocumentWithTimeout).mock.calls[0]![1] as string;
    expect(scriptArg).not.toContain('__ANTI_DEBUG_FILTER_PATTERNS__');
    expect(scriptArg).toContain('custom');
  });
});

describe('AntiDebugToolHandlers — injectScripts persistent vs non-persistent paths', () => {
  // @ts-expect-error
  let collectorMock: vi.Mocked<CodeCollector>;
  let pageMock: any;
  let handlers: AntiDebugToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageMock = {};
    collectorMock = {
      getActivePage: vi.fn().mockResolvedValue(pageMock),
    } as any;
    handlers = new AntiDebugToolHandlers(collectorMock);
  });

  it('persistent=true: calls both evaluateOnNewDocument and evaluate for each script', async () => {
    await handlers.handleAntiDebugBypassAll({ persistent: true });
    // 4 scripts x 2 calls each = 8 total
    expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalledTimes(4);
    expect(evaluateWithTimeout).toHaveBeenCalledTimes(4);
  });

  it('persistent=false: calls only evaluate for each script', async () => {
    await handlers.handleAntiDebugBypassAll({ persistent: false });
    expect(evaluateOnNewDocumentWithTimeout).not.toHaveBeenCalled();
    expect(evaluateWithTimeout).toHaveBeenCalledTimes(4);
  });

  it('handleAntiDebugBypassConsoleDetect always uses persistent=true', async () => {
    await handlers.handleAntiDebugBypassConsoleDetect({});
    expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalledTimes(1);
    expect(evaluateWithTimeout).toHaveBeenCalledTimes(1);
  });
});
