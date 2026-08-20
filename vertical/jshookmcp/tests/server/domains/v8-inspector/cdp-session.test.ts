/**
 * Unit tests for the target-aware CDP session resolver.
 *
 * v8-inspector's CDP-backed tools resolve a session through resolveTargetSession:
 * the collector's attached-target session (worker/SW/page from
 * browser_attach_cdp_target) wins over the page fallback. The `owned` flag
 * tells callers whether they must detach — detaching an attached-target
 * session would tear down the browser domain's attach state, so only the
 * page-fallback session (owned=true) is detachable.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  normalizeSessionSource,
  resolveTargetSession,
  type CDPSessionLike,
  type TargetSessionResolver,
} from '@server/domains/v8-inspector/handlers/cdp-session';

function makeSession(overrides: Partial<CDPSessionLike> = {}): CDPSessionLike {
  return {
    send: vi.fn().mockResolvedValue({}),
    detach: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  };
}

function makePage(opts: { url?: string | (() => string); session?: CDPSessionLike } = {}): {
  createCDPSession: () => Promise<CDPSessionLike>;
  url?: string | (() => string);
} {
  const session = opts.session ?? makeSession();
  return {
    createCDPSession: async () => session,
    ...(opts.url !== undefined ? { url: opts.url } : {}),
  };
}

describe('normalizeSessionSource', () => {
  it('wraps a bare getPage function into { getPage }', () => {
    const fn = async (): Promise<unknown> => undefined;
    const resolver = normalizeSessionSource(fn);
    expect(resolver.getPage).toBe(fn);
    expect(resolver.getAttachedTargetSession).toBeUndefined();
  });

  it('returns a resolver object as-is', () => {
    const resolver: TargetSessionResolver = {
      getAttachedTargetSession: () => null,
      getAttachedTargetInfo: () => null,
    };
    expect(normalizeSessionSource(resolver)).toBe(resolver);
  });

  it('returns an empty resolver for undefined/null', () => {
    expect(normalizeSessionSource(undefined)).toEqual({});
    // @ts-expect-error — exercising the null guard at runtime
    expect(normalizeSessionSource(null)).toEqual({});
  });
});

describe('resolveTargetSession — attached target priority', () => {
  it('returns the attached session with owned=false and target from info', async () => {
    const attached = makeSession();
    const resolver: TargetSessionResolver = {
      getAttachedTargetSession: () => attached,
      getAttachedTargetInfo: () => ({
        type: 'service_worker',
        url: 'http://localhost:9999/sw.js',
        targetId: 'SW-1',
      }),
      getPage: async () => makePage(), // must NOT be used
    };
    const resolved = await resolveTargetSession(resolver);
    expect(resolved.session).toBe(attached);
    expect(resolved.owned).toBe(false);
    expect(resolved.target).toEqual({
      type: 'service_worker',
      url: 'http://localhost:9999/sw.js',
      targetId: 'SW-1',
    });
  });

  it('keeps the attached session when info accessor is missing (target fields null)', async () => {
    const attached = makeSession();
    const resolved = await resolveTargetSession({
      getAttachedTargetSession: () => attached,
    });
    expect(resolved.session).toBe(attached);
    expect(resolved.owned).toBe(false);
    expect(resolved.target).toEqual({ type: null, url: null, targetId: null });
  });

  it('falls through to page when attached session accessor returns null', async () => {
    const pageSession = makeSession();
    const resolved = await resolveTargetSession({
      getAttachedTargetSession: () => null,
      getAttachedTargetInfo: () => ({ type: 'worker' }),
      getPage: async () => makePage({ session: pageSession, url: 'http://localhost:9999/page' }),
    });
    expect(resolved.session).toBe(pageSession);
    expect(resolved.owned).toBe(true);
    expect(resolved.target.type).toBe('page');
    expect(resolved.target.url).toBe('http://localhost:9999/page');
  });
});

describe('resolveTargetSession — page fallback', () => {
  it('creates an owned session from the page and reads url() method', async () => {
    const pageSession = makeSession();
    const resolved = await resolveTargetSession({
      getPage: async () => makePage({ session: pageSession, url: () => 'http://localhost:9999/' }),
    });
    expect(resolved.session).toBe(pageSession);
    expect(resolved.owned).toBe(true);
    expect(resolved.target).toEqual({
      type: 'page',
      url: 'http://localhost:9999/',
      targetId: null,
    });
  });

  it('reads a string url property too', async () => {
    const pageSession = makeSession();
    const resolved = await resolveTargetSession({
      getPage: async () => makePage({ session: pageSession, url: 'http://localhost:9999/' }),
    });
    expect(resolved.target.url).toBe('http://localhost:9999/');
  });

  it('returns null session when getPage is absent', async () => {
    const resolved = await resolveTargetSession({});
    expect(resolved.session).toBeNull();
    expect(resolved.owned).toBe(false);
    expect(resolved.target.type).toBe('page');
  });

  it('returns null session when getPage resolves to undefined', async () => {
    const resolved = await resolveTargetSession({ getPage: async () => undefined });
    expect(resolved.session).toBeNull();
  });

  it('returns null session when page is not CDP-page-like', async () => {
    const resolved = await resolveTargetSession({ getPage: async () => ({ foo: 'bar' }) });
    expect(resolved.session).toBeNull();
  });

  it('returns null session when createCDPSession yields a non-session', async () => {
    const resolved = await resolveTargetSession({
      getPage: async () => ({ createCDPSession: async () => ({ not: 'a session' }) }),
    });
    expect(resolved.session).toBeNull();
  });

  it('swallows getPage rejection and returns null session', async () => {
    const resolved = await resolveTargetSession({
      getPage: async () => {
        throw new Error('boom');
      },
    });
    expect(resolved.session).toBeNull();
  });

  it('swallows createCDPSession rejection and returns null session', async () => {
    const resolved = await resolveTargetSession({
      getPage: async () => ({ createCDPSession: async () => Promise.reject(new Error('nope')) }),
    });
    expect(resolved.session).toBeNull();
  });
});
