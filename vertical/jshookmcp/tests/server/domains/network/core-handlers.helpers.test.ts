import { describe, expect, it } from 'vitest';
import type { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor';
import {
  ensureNetworkEnabled,
  buildNotEnabledResponse,
  getMergedNetworkRequestsFromMonitor as helpersMerged,
} from '@server/domains/network/handlers/core-handlers.helpers';
import { getMergedNetworkRequestsFromMonitor as canonicalMerged } from '@server/domains/network/request-merge';

describe('core-handlers.helpers', () => {
  it('re-exports the real merge implementation (not a bare getNetworkRequests passthrough)', async () => {
    // The helpers export must be the canonical request-merge function, so callers
    // get CDP + injected XHR/Fetch dedup — not raw CDP requests only.
    expect(helpersMerged).toBe(canonicalMerged);

    const monitor = {
      getNetworkRequests: () => [
        {
          requestId: 'cdp-1',
          url: 'https://example.com/api/1',
          method: 'GET',
          type: 'XHR',
          timestamp: 1000,
        },
      ],
      getXHRRequests: async () => [
        { url: 'https://example.com/api/1', method: 'GET', type: 'XHR', timestamp: 1001 },
      ],
      getFetchRequests: async () => [],
    };
    const merged = await helpersMerged(monitor);
    // The injected XHR request is merged (matched by fingerprint), so it must NOT
    // appear as a duplicate — proving the merge path runs.
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ requestId: 'cdp-1', injected: true });
  });

  it('ensureNetworkEnabled works from a monitor-only dependency shape', async () => {
    let enabledCalls = 0;
    const monitor = {
      isNetworkEnabled: () => false,
      enable: async () => {
        enabledCalls += 1;
      },
    };
    const result = await ensureNetworkEnabled(
      { consoleMonitor: monitor as unknown as ConsoleMonitor },
      {
        autoEnable: true,
        enableExceptions: true,
      },
    );
    expect(result).toEqual({ enabled: false, autoEnabled: true });
    expect(enabledCalls).toBe(1);
  });

  it('ensureNetworkEnabled surfaces enable errors', async () => {
    const monitor = {
      isNetworkEnabled: () => false,
      enable: async () => {
        throw new Error('no active page');
      },
    };
    const result = await ensureNetworkEnabled(
      { consoleMonitor: monitor as unknown as ConsoleMonitor },
      {
        autoEnable: true,
        enableExceptions: false,
      },
    );
    expect(result.enabled).toBe(false);
    expect(result.error).toBe('no active page');
  });

  it('buildNotEnabledResponse matches the legacy not-enabled shape', () => {
    const response = buildNotEnabledResponse(false);
    // content blocks are a discriminated union; assert the text shape before reading .text
    const payloadText = (response.content?.[0] as { text?: string } | undefined)?.text ?? '{}';
    const body = JSON.parse(payloadText);
    expect(body).toMatchObject({
      requests: [],
      total: 0,
    });
    const serialized = JSON.stringify(response);
    expect(serialized).toContain('Network monitoring is not enabled');
    expect(serialized).toContain('Set autoEnable=true');

    const failed = buildNotEnabledResponse(true, 'boom');
    expect(failed.content?.[0]).toBeDefined();
    expect(JSON.stringify(failed)).toContain('boom');
  });
});
