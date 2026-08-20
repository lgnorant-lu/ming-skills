import { beforeEach, describe, expect, it } from 'vitest';
import { MojoMonitor, deriveDirectionFromPayload, type MojoMessage } from '@modules/mojo-ipc';

/**
 * These tests exercise the pure, CI-verifiable parts of the monitor:
 * direction inference from header flags, direction-aware filtering, and
 * the non-destructive summarize() aggregator. None of them require Frida,
 * so child_process is NOT mocked here.
 */

function activate(monitor: MojoMonitor): void {
  // Mirror the existing test convention: set the private flag directly.
  (monitor as unknown as { active: boolean }).active = true;
}

function record(
  monitor: MojoMonitor,
  overrides: Partial<MojoMessage> & { interfaceName: string; messageType: string },
): void {
  monitor.recordMessage({
    timestamp: overrides.timestamp ?? 1,
    sourcePid: overrides.sourcePid ?? 0,
    targetPid: overrides.targetPid ?? 0,
    interfaceName: overrides.interfaceName,
    messageType: overrides.messageType,
    payload: overrides.payload ?? '',
    size: overrides.size ?? 0,
    direction: overrides.direction,
  });
}

describe('deriveDirectionFromPayload', () => {
  it('classifies a request when the flags byte has no response/sync bits', () => {
    // version=0x01, flags=0x00
    expect(deriveDirectionFromPayload('0100')).toBe('request');
    // flags=0x01 (expects_response bit set) is still a request, not a response
    expect(deriveDirectionFromPayload('0101')).toBe('request');
  });

  it('classifies a response when flags & 0x02', () => {
    expect(deriveDirectionFromPayload('0102')).toBe('response');
  });

  it('classifies a sync call when flags & 0x04', () => {
    expect(deriveDirectionFromPayload('0104')).toBe('sync');
  });

  it('prefers response over sync when both bits are set', () => {
    // flags 0x06 = response + sync — mirrors the decoder's decodeFlags order
    expect(deriveDirectionFromPayload('0106')).toBe('response');
  });

  it('tolerates whitespace and uppercase hex', () => {
    expect(deriveDirectionFromPayload('01 02')).toBe('response');
    expect(deriveDirectionFromPayload('01A4')).toBe('sync');
  });

  it('returns undefined for payloads shorter than a header', () => {
    expect(deriveDirectionFromPayload('01')).toBeUndefined();
    expect(deriveDirectionFromPayload('')).toBeUndefined();
  });

  it('returns undefined for non-hex input (fail-soft, no throw)', () => {
    expect(deriveDirectionFromPayload('zzzz')).toBeUndefined();
    expect(deriveDirectionFromPayload('nothex')).toBeUndefined();
  });

  it('returns undefined for non-string input', () => {
    expect(deriveDirectionFromPayload(undefined)).toBeUndefined();
    expect(deriveDirectionFromPayload(null)).toBeUndefined();
  });
});

describe('MojoMonitor — direction-aware record + filter', () => {
  let monitor: MojoMonitor;

  beforeEach(() => {
    monitor = new MojoMonitor();
    activate(monitor);
  });

  it('derives direction from the payload when not explicitly provided', async () => {
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
      payload: '0102aabb', // response
    });
    const result = await monitor.getMessages();
    expect(result.messages[0]?.direction).toBe('response');
  });

  it('preserves an explicitly-provided direction over derivation', async () => {
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
      payload: '0102aabb', // would derive 'response'
      direction: 'request', // but caller overrides
    });
    const result = await monitor.getMessages();
    expect(result.messages[0]?.direction).toBe('request');
  });

  it('leaves direction undefined when the payload cannot be parsed', async () => {
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
      payload: 'xx',
    });
    const result = await monitor.getMessages();
    expect(result.messages[0]?.direction).toBeUndefined();
  });

  it('filters messages by direction', async () => {
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: '7',
      payload: '0101', // request
      timestamp: 1000,
    });
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: '7',
      payload: '0102', // response
      timestamp: 2000,
    });
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: '7',
      payload: '0104', // sync
      timestamp: 3000,
    });

    const responses = await monitor.getMessages({ direction: 'response' });
    expect(responses.filtered).toBe(true);
    expect(responses.messages).toHaveLength(1);
    expect(responses.messages[0]?.direction).toBe('response');
    expect(responses.messages[0]?.timestamp).toBe(2000);
  });

  it('direction filter excludes messages whose direction could not be derived', async () => {
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: '7',
      payload: 'xx', // unparseable → undefined direction
    });
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: '7',
      payload: '0101', // request
    });

    const requests = await monitor.getMessages({ direction: 'request' });
    expect(requests.messages).toHaveLength(1);
    expect(requests.messages[0]?.payload).toBe('0101');
  });
});

describe('MojoMonitor — summarizeMessages', () => {
  let monitor: MojoMonitor;

  beforeEach(() => {
    monitor = new MojoMonitor();
    activate(monitor);
  });

  it('returns an empty summary when no messages have been recorded', async () => {
    const summary = await monitor.summarizeMessages();
    expect(summary.total).toBe(0);
    expect(summary.totalBytes).toBe(0);
    expect(summary.byInterface).toEqual([]);
    expect(summary.byMethod).toEqual([]);
    expect(summary.topInterfaces).toEqual([]);
    expect(summary.timeWindow).toEqual({ earliest: null, latest: null, durationMs: 0 });
    expect(summary.filtered).toBe(false);
  });

  it('aggregates by interface, method, direction and bytes', async () => {
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
      payload: '0101', // request
      size: 10,
      timestamp: 1000,
    });
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
      payload: '0102', // response
      size: 20,
      timestamp: 1100,
    });
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'FollowRedirect',
      payload: '0101', // request
      size: 5,
      timestamp: 1200,
    });
    record(monitor, {
      interfaceName: 'blink.mojom.WidgetHost',
      messageType: 'SetCursor',
      payload: '0104', // sync
      size: 8,
      timestamp: 1300,
    });

    const summary = await monitor.summarizeMessages();

    expect(summary.total).toBe(4);
    expect(summary.totalBytes).toBe(43);
    expect(summary.byDirection).toEqual({ request: 2, response: 1, sync: 1, unknown: 0 });

    // Interfaces sorted by count desc; URL loader factory dominates (3 msgs).
    expect(summary.byInterface[0]).toMatchObject({
      interface: 'network.mojom.URLLoaderFactory',
      count: 3,
      bytes: 35,
      distinctMethods: 2,
    });
    expect(summary.byInterface[0]?.directionBreakdown).toEqual({
      request: 2,
      response: 1,
      sync: 0,
      unknown: 0,
    });
    expect(summary.byInterface[1]).toMatchObject({
      interface: 'blink.mojom.WidgetHost',
      count: 1,
      bytes: 8,
      distinctMethods: 1,
    });

    // Methods sorted by count desc.
    expect(summary.byMethod[0]).toMatchObject({
      interface: 'network.mojom.URLLoaderFactory',
      method: 'CreateLoaderAndStart',
      count: 2,
      bytes: 30,
    });

    expect(summary.timeWindow).toEqual({ earliest: 1000, latest: 1300, durationMs: 300 });
  });

  it('is non-destructive — repeated calls see the same buffer', async () => {
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
      payload: '0101',
    });
    const first = await monitor.summarizeMessages();
    const second = await monitor.summarizeMessages();
    expect(second.total).toBe(first.total);
    expect(second.total).toBe(1);
    // And getMessages (which drains) still has the message available afterwards.
    const drained = await monitor.getMessages();
    expect(drained.messages).toHaveLength(1);
  });

  it('applies interface/method/direction filters', async () => {
    record(monitor, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
      payload: '0101',
      size: 10,
    });
    record(monitor, {
      interfaceName: 'blink.mojom.WidgetHost',
      messageType: 'SetCursor',
      payload: '0104',
      size: 8,
    });

    const filtered = await monitor.summarizeMessages({
      interfaceName: 'network.mojom.URLLoaderFactory',
    });
    expect(filtered.filtered).toBe(true);
    expect(filtered.total).toBe(1);
    expect(filtered.byInterface).toHaveLength(1);
    expect(filtered.byInterface[0]?.interface).toBe('network.mojom.URLLoaderFactory');

    const responsesOnly = await monitor.summarizeMessages({ direction: 'sync' });
    expect(responsesOnly.total).toBe(1);
    expect(responsesOnly.byInterface[0]?.interface).toBe('blink.mojom.WidgetHost');
  });

  it('respects a custom topN cap', async () => {
    for (let i = 0; i < 7; i += 1) {
      record(monitor, {
        interfaceName: `iface.mojom.Iface${i}`,
        messageType: 'Method',
        payload: '0101',
      });
    }
    const summary = await monitor.summarizeMessages({ topN: 3 });
    expect(summary.topInterfaces).toHaveLength(3);
    expect(summary.byInterface).toHaveLength(7);
  });

  it('returns an empty summary when inactive', async () => {
    const inactive = new MojoMonitor();
    const summary = await inactive.summarizeMessages();
    expect(summary.total).toBe(0);
    expect(summary.filtered).toBe(false);
  });
});
