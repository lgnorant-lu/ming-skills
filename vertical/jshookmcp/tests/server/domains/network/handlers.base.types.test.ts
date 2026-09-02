import { describe, expect, it } from 'vitest';

import {
  isNetworkRequestPayload,
  isNetworkResponsePayload,
  isCpuProfileNodePayload,
} from '@server/domains/network/handlers.base.types';

describe('network handlers.base.types type guards', () => {
  it('isNetworkResponsePayload accepts a finite numeric status', () => {
    expect(isNetworkResponsePayload({ status: 200, body: 'ok' })).toBe(true);
  });

  it('isNetworkResponsePayload rejects NaN / Infinity status (typeof number but unusable)', () => {
    expect(isNetworkResponsePayload({ status: Number.NaN })).toBe(false);
    expect(isNetworkResponsePayload({ status: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('isNetworkResponsePayload rejects non-objects and non-numeric status', () => {
    expect(isNetworkResponsePayload(null)).toBe(false);
    expect(isNetworkResponsePayload('status')).toBe(false);
    expect(isNetworkResponsePayload({ status: '200' })).toBe(false);
  });

  it('isNetworkRequestPayload requires string url and method', () => {
    expect(isNetworkRequestPayload({ url: 'https://x', method: 'GET' })).toBe(true);
    expect(isNetworkRequestPayload({ url: 'https://x' })).toBe(false);
    expect(isNetworkRequestPayload({ url: 42, method: 'GET' })).toBe(false);
    expect(isNetworkRequestPayload(null)).toBe(false);
  });

  it('isCpuProfileNodePayload validates optional fields', () => {
    expect(isCpuProfileNodePayload({ hitCount: 3 })).toBe(true);
    expect(isCpuProfileNodePayload({ hitCount: '3' })).toBe(false);
    expect(isCpuProfileNodePayload({ callFrame: { lineNumber: 12 } })).toBe(true);
    expect(isCpuProfileNodePayload({ callFrame: { lineNumber: '12' } })).toBe(false);
  });
});
