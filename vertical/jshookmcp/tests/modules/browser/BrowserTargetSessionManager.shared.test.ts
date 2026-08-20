import { describe, expect, it } from 'vitest';
import {
  AUTO_MANAGED_TARGET_TYPES,
  matchesManagedTargetTypes,
  matchesPersistentScriptTarget,
  matchesTargetFilters,
  normalizeBrowserTargetInfo,
  readAttachedTargetSessionId,
  readDetachedTargetSessionId,
  readTargetInfoPayload,
  type BrowserTargetInfo,
  type PersistentScriptEntry,
} from '@modules/browser/BrowserTargetSessionManager.shared';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('BrowserTargetSessionManager.shared', () => {
  const iframeTarget: BrowserTargetInfo = {
    targetId: 'frame-1',
    type: 'iframe',
    title: 'Inner frame',
    url: withPath(TEST_URLS.root, 'frame'),
    attached: true,
  };

  it('matches managed target types with defaults and explicit type lists', () => {
    expect(AUTO_MANAGED_TARGET_TYPES.has('page')).toBe(true);
    expect(matchesManagedTargetTypes('iframe')).toBe(true);
    expect(matchesManagedTargetTypes('worker')).toBe(false);
    expect(matchesManagedTargetTypes('iframe', ['iframe'])).toBe(true);
    expect(matchesManagedTargetTypes('page', ['iframe'])).toBe(false);
  });

  it('matches persistent script targets against target type filters', () => {
    const unrestrictedScript: PersistentScriptEntry = {
      id: 'script-1',
      source: 'window.a = 1;',
    };
    const iframeOnlyScript: PersistentScriptEntry = {
      id: 'script-2',
      source: 'window.b = 1;',
      targetTypes: ['iframe'],
    };
    const pageOnlyScript: PersistentScriptEntry = {
      id: 'script-3',
      source: 'window.c = 1;',
      targetTypes: ['page'],
    };

    expect(matchesPersistentScriptTarget(iframeTarget, unrestrictedScript)).toBe(true);
    expect(matchesPersistentScriptTarget(iframeTarget, iframeOnlyScript)).toBe(true);
    expect(matchesPersistentScriptTarget(iframeTarget, pageOnlyScript)).toBe(false);
  });

  it('matches target filters across all supported filter fields', () => {
    expect(matchesTargetFilters(iframeTarget, {})).toBe(true);
    expect(matchesTargetFilters(iframeTarget, { type: 'iframe' })).toBe(true);
    expect(matchesTargetFilters(iframeTarget, { type: 'page' })).toBe(false);
    expect(matchesTargetFilters(iframeTarget, { types: ['iframe', 'page'] })).toBe(true);
    expect(matchesTargetFilters(iframeTarget, { types: ['page'] })).toBe(false);
    expect(matchesTargetFilters(iframeTarget, { targetId: 'frame-1' })).toBe(true);
    expect(matchesTargetFilters(iframeTarget, { targetId: 'frame-2' })).toBe(false);
    expect(matchesTargetFilters(iframeTarget, { attachedOnly: true })).toBe(true);
    expect(
      matchesTargetFilters(
        {
          ...iframeTarget,
          attached: false,
        },
        { attachedOnly: true },
      ),
    ).toBe(false);
    expect(matchesTargetFilters(iframeTarget, { urlPattern: '/frame' })).toBe(true);
    expect(matchesTargetFilters(iframeTarget, { urlPattern: '/missing' })).toBe(false);
    expect(matchesTargetFilters(iframeTarget, { titlePattern: 'Inner' })).toBe(true);
    expect(matchesTargetFilters(iframeTarget, { titlePattern: 'Outer' })).toBe(false);
  });

  it('normalizes browser target info and rejects incomplete records', () => {
    expect(
      normalizeBrowserTargetInfo({
        targetId: 'page-1',
        type: 'page',
        title: 'Main',
        url: TEST_URLS.root,
        attached: 1,
        openerId: 'opener-1',
        canAccessOpener: true,
        openerFrameId: 'frame-0',
        browserContextId: 'ctx-1',
        subtype: 'prerender',
      }),
    ).toEqual({
      targetId: 'page-1',
      type: 'page',
      title: 'Main',
      url: TEST_URLS.root,
      attached: true,
      openerId: 'opener-1',
      canAccessOpener: true,
      openerFrameId: 'frame-0',
      browserContextId: 'ctx-1',
      subtype: 'prerender',
    });

    expect(normalizeBrowserTargetInfo({ type: 'page' })).toBeNull();
    expect(normalizeBrowserTargetInfo({ targetId: 'page-1' })).toBeNull();
  });

  it('extracts attached and detached session ids safely', () => {
    expect(readAttachedTargetSessionId({ sessionId: 'session-1' })).toBe('session-1');
    expect(readAttachedTargetSessionId({ sessionId: '' })).toBeNull();
    expect(readAttachedTargetSessionId(null)).toBeNull();

    expect(readDetachedTargetSessionId({ sessionId: 'session-2' })).toBe('session-2');
    expect(readDetachedTargetSessionId({ sessionId: 2 })).toBeNull();
    expect(readDetachedTargetSessionId(undefined)).toBeNull();
  });

  it('extracts targetInfo payloads safely from attached/changed events', () => {
    expect(readTargetInfoPayload({ targetInfo: { targetId: 'frame-1' } })).toEqual({
      targetId: 'frame-1',
    });
    expect(readTargetInfoPayload({ targetInfo: 'not-an-object' })).toBeNull();
    expect(readTargetInfoPayload({})).toBeNull();
    expect(readTargetInfoPayload('bad-payload')).toBeNull();
  });
});
