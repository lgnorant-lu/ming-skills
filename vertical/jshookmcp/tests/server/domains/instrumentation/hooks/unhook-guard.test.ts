import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AIHookToolHandlers,
  buildUnhookGuardBootstrap,
} from '../../../../../src/server/domains/instrumentation/hooks/ai-handlers';
import type { PageController } from '../../../../../src/server/domains/shared/modules/collector';
import { evaluateWithTimeout } from '../../../../../src/modules/collector/PageController';

vi.mock('../../../../../src/modules/collector/PageController', () => ({
  evaluateWithTimeout: vi.fn(),
  evaluateOnNewDocumentWithTimeout: vi.fn(),
}));

vi.mock('../../../../../src/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe('buildUnhookGuardBootstrap', () => {
  it('returns empty string when no guard options are supplied', () => {
    expect(buildUnhookGuardBootstrap('h', {})).toBe('');
    expect(buildUnhookGuardBootstrap('h', { maxMatches: undefined })).toBe('');
  });

  it('emits maxMatches + metadata init + the guard helper', () => {
    const s = buildUnhookGuardBootstrap('myHook', { maxMatches: 5 });
    expect(s).toContain('__aiHookMetadata');
    expect(s).toContain('"myHook"');
    expect(s).toContain('__m.maxMatches = 5');
    expect(s).toContain('__m.matchCount = 0');
    expect(s).toContain('__aiHookUnhookGuard');
  });

  it('compiles unhookPredicate via new Function("value", src)', () => {
    const s = buildUnhookGuardBootstrap('h', { unhookPredicate: 'value === "secret"' });
    expect(s).toContain("new Function('value',");
    expect(s).toContain('value ===');
    expect(s).toContain('secret');
  });

  it('combines maxMatches + predicate', () => {
    const s = buildUnhookGuardBootstrap('h', { maxMatches: 3, unhookPredicate: 'value > 10' });
    expect(s).toContain('__m.maxMatches = 3');
    expect(s).toContain('value > 10');
  });

  it('JSON-quotes the hookId so it cannot break out of the bootstrap', () => {
    const s = buildUnhookGuardBootstrap('h");evil()', { maxMatches: 1 });
    // The embedded quote is JSON-escaped (backslash-quote), so it stays inside
    // the string literal and cannot close it.
    expect(s).toContain('\\"');
  });
});

describe('AIHookToolHandlers — conditional unhook guard', () => {
  let pageControllerMock: PageController & {
    getPage: ReturnType<typeof vi.fn>;
    hasAttachedTargetSession: ReturnType<typeof vi.fn>;
  };
  let handlers: AIHookToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageControllerMock = {
      getPage: vi.fn().mockResolvedValue({}),
      hasAttachedTargetSession: vi.fn().mockReturnValue(false),
    } as any;
    handlers = new AIHookToolHandlers(pageControllerMock);
  });

  it('prepends the guard bootstrap before user code when maxMatches is set', async () => {
    vi.mocked(evaluateWithTimeout).mockResolvedValue(undefined as any);
    const res = await handlers.handleAIHookInject({
      hookId: 'guarded',
      code: 'window.__probe = 1',
      maxMatches: 4,
    });
    const body = JSON.parse((res as any).content[0].text);
    expect(body.success).toBe(true);
    expect(body.unhookGuard).toEqual({ maxMatches: 4, enabled: true });
    expect(evaluateWithTimeout).toHaveBeenCalledTimes(1);
    const injected = vi.mocked(evaluateWithTimeout).mock.calls[0]![1] as string;
    expect(injected).toContain('__aiHookUnhookGuard');
    expect(injected).toContain('__m.maxMatches = 4');
    expect(injected).toContain('window.__probe = 1'); // user code still present, after the guard
  });

  it('leaves user code byte-identical when no guard options are supplied', async () => {
    vi.mocked(evaluateWithTimeout).mockResolvedValue(undefined as any);
    const res = await handlers.handleAIHookInject({
      hookId: 'plain',
      code: 'window.__probe = 1',
    });
    const body = JSON.parse((res as any).content[0].text);
    expect(body.success).toBe(true);
    expect(body.unhookGuard).toBeNull();
    const injected = vi.mocked(evaluateWithTimeout).mock.calls[0]![1] as string;
    expect(injected).toBe('window.__probe = 1');
    expect(injected).not.toContain('__aiHookUnhookGuard');
  });

  it('threads unhookPredicate into the injected guard', async () => {
    vi.mocked(evaluateWithTimeout).mockResolvedValue(undefined as any);
    await handlers.handleAIHookInject({
      hookId: 'pred',
      code: 'window.__probe = 1',
      unhookPredicate: 'value === "boom"',
    });
    const injected = vi.mocked(evaluateWithTimeout).mock.calls[0]![1] as string;
    expect(injected).toContain('value ===');
    expect(injected).toContain('boom');
    expect(injected).toContain('new Function');
  });
});
