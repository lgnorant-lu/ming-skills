import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers.impl';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

function createMockMonitor() {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    getUnavailableReason: vi.fn().mockReturnValue(undefined),
    probeAvailability: vi.fn().mockResolvedValue({
      available: true,
      fridaAvailable: true,
      fridaCliAvailable: true,
      reason: undefined,
    }),
    isActive: vi.fn().mockReturnValue(true),
    isSimulationMode: vi.fn().mockReturnValue(false),
    didFridaProbeSucceed: vi.fn().mockReturnValue(false),
    isLiveCapture: vi.fn().mockReturnValue(false),
    getInterfaceCatalogSource: vi.fn().mockReturnValue('observed'),
    getObservedInterfaceCount: vi.fn().mockReturnValue(2),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getDeviceId: vi.fn().mockReturnValue(null),
    listInterfaces: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue({
      messages: [],
      totalAvailable: 0,
      filtered: false,
      simulation: false,
    }),
    summarizeMessages: vi.fn().mockResolvedValue({
      total: 0,
      totalBytes: 0,
      byDirection: { request: 0, response: 0, sync: 0, unknown: 0 },
      byInterface: [],
      byMethod: [],
      topInterfaces: [],
      topMethods: [],
      timeWindow: { earliest: null, latest: null, durationMs: 0 },
      filtered: false,
      simulation: false,
    }),
  };
}

describe('MojoIPCHandlers — direction filter + summarize', () => {
  let monitor: ReturnType<typeof createMockMonitor>;
  let handlers: MojoIPCHandlers;

  beforeEach(() => {
    monitor = createMockMonitor();
    handlers = new MojoIPCHandlers(monitor as any, undefined);
  });

  // ── handleMojoMessagesGet direction param ──────────────────────────────

  describe('handleMojoMessagesGet — direction filter', () => {
    it('passes direction filter through to monitor.getMessages', async () => {
      await handlers.handleMojoMessagesGet({ direction: 'response' });
      expect(monitor.getMessages).toHaveBeenCalledWith({
        limit: 100,
        interfaceName: undefined,
        messageType: undefined,
        sinceTimestamp: undefined,
        hexSearch: undefined,
        direction: 'response',
      });
    });

    it('leaves direction undefined when not provided', async () => {
      await handlers.handleMojoMessagesGet({ limit: 5 });
      expect(monitor.getMessages).toHaveBeenCalledWith({
        limit: 5,
        interfaceName: undefined,
        messageType: undefined,
        sinceTimestamp: undefined,
        hexSearch: undefined,
        direction: undefined,
      });
    });

    it('rejects an unknown direction value via the tool wrapper', async () => {
      const response = await handlers.handleMojoMessagesGetTool({ direction: 'sideways' });
      const payload = ResponseBuilder.parse<Record<string, unknown>>(response);
      expect(payload).toMatchObject({ success: false });
      expect(String(payload['error'])).toContain('direction');
    });
  });

  // ── handleMojoMessagesSummarize ─────────────────────────────────────────

  describe('handleMojoMessagesSummarize', () => {
    it('forwards filter + topN options to the monitor aggregator', async () => {
      const summaryFixture = {
        total: 3,
        totalBytes: 42,
        byDirection: { request: 2, response: 1, sync: 0, unknown: 0 },
        byInterface: [
          {
            interface: 'network.mojom.URLLoaderFactory',
            count: 3,
            bytes: 42,
            distinctMethods: 2,
            directionBreakdown: { request: 2, response: 1, sync: 0, unknown: 0 },
          },
        ],
        byMethod: [
          {
            interface: 'network.mojom.URLLoaderFactory',
            method: 'CreateLoaderAndStart',
            count: 2,
            bytes: 30,
          },
        ],
        topInterfaces: [
          {
            interface: 'network.mojom.URLLoaderFactory',
            count: 3,
            bytes: 42,
            distinctMethods: 2,
            directionBreakdown: { request: 2, response: 1, sync: 0, unknown: 0 },
          },
        ],
        topMethods: [
          {
            interface: 'network.mojom.URLLoaderFactory',
            method: 'CreateLoaderAndStart',
            count: 2,
            bytes: 30,
          },
        ],
        timeWindow: { earliest: 1000, latest: 1300, durationMs: 300 },
        filtered: true,
        simulation: false,
      };
      monitor.summarizeMessages.mockResolvedValue(summaryFixture);

      const result = await handlers.handleMojoMessagesSummarize({
        interface: 'network.mojom.URLLoaderFactory',
        messageType: 7,
        sinceTimestamp: 100,
        hexSearch: 'aa',
        direction: 'request',
        topN: 3,
      });

      expect(monitor.summarizeMessages).toHaveBeenCalledWith({
        interfaceName: 'network.mojom.URLLoaderFactory',
        messageType: 7,
        sinceTimestamp: 100,
        hexSearch: 'aa',
        direction: 'request',
        topN: 3,
      });
      expect(result).toMatchObject({
        success: true,
        available: true,
        active: true,
        interfaceCatalogSource: 'observed',
        observedInterfaceCount: 2,
      });
      // summary is threaded verbatim
      expect((result as Record<string, unknown>)['summary']).toMatchObject({
        total: 3,
        totalBytes: 42,
      });
    });

    it('defaults topN to undefined when omitted (monitor uses 5)', async () => {
      await handlers.handleMojoMessagesSummarize({});
      const call = monitor.summarizeMessages.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call['topN']).toBeUndefined();
    });

    it('returns a simulated stub when the monitor is in simulation mode', async () => {
      monitor.isSimulationMode.mockReturnValue(true);
      monitor.summarizeMessages.mockResolvedValue({
        total: 0,
        totalBytes: 0,
        byDirection: { request: 0, response: 0, sync: 0, unknown: 0 },
        byInterface: [],
        byMethod: [],
        topInterfaces: [],
        topMethods: [],
        timeWindow: { earliest: null, latest: null, durationMs: 0 },
        filtered: false,
        simulation: true,
      });
      const result = (await handlers.handleMojoMessagesSummarize({})) as Record<string, unknown>;
      expect(result['_stub']).toBe('simulated');
      expect(result['warning']).toContain('simulation mode');
    });

    it('returns an unavailable payload when the monitor is not available', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue('Frida not installed');
      const result = (await handlers.handleMojoMessagesSummarize({})) as Record<string, unknown>;
      expect(monitor.summarizeMessages).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: false,
        available: false,
        capability: 'mojo_ipc_monitoring',
        tool: 'mojo_messages_summarize',
        error: 'Frida not installed',
      });
      // Always include the empty breakdown for client convenience.
      expect(result['byDirection']).toEqual({ request: 0, response: 0, sync: 0, unknown: 0 });
    });

    it('wraps handler output in a ToolResponse', async () => {
      const response = await handlers.handleMojoMessagesSummarizeTool({});
      const payload = ResponseBuilder.parse<Record<string, unknown>>(response);
      expect(payload).toMatchObject({ success: true });
    });

    it('rejects an unknown direction value via the tool wrapper', async () => {
      const response = await handlers.handleMojoMessagesSummarizeTool({ direction: 'sideways' });
      const payload = ResponseBuilder.parse<Record<string, unknown>>(response);
      expect(payload).toMatchObject({ success: false });
      expect(String(payload['error'])).toContain('direction');
    });
  });

  // ── handleMojoEncodeMessage v2 header options ───────────────────────────

  describe('handleMojoEncodeMessage — v2 header options', () => {
    let realDecoder: { encodeMessage: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      realDecoder = { encodeMessage: vi.fn().mockReturnValue('deadbeef') };
      handlers = new MojoIPCHandlers(monitor as any, realDecoder as any);
    });

    it('forwards header flags + ids as MojoEncodeOptions', async () => {
      await handlers.handleMojoEncodeMessage({
        interfaceName: 'network.mojom.URLLoaderClient',
        messageType: 'OnReceiveResponse',
        fields: [],
        header: {
          isResponse: true,
          interfaceId: 0xdeadbeef,
          requestId: 0x0102030405060708n.toString(),
        },
      });
      expect(realDecoder.encodeMessage).toHaveBeenCalledWith(
        'network.mojom.URLLoaderClient',
        'OnReceiveResponse',
        [],
        { isResponse: true, interfaceId: 0xdeadbeef, requestId: 0x0102030405060708n },
      );
    });

    it('passes undefined when no header is provided (v1 default)', async () => {
      await handlers.handleMojoEncodeMessage({
        interfaceName: 'network.mojom.NetworkService',
        messageType: 1,
        fields: [],
      });
      expect(realDecoder.encodeMessage).toHaveBeenCalledWith(
        'network.mojom.NetworkService',
        1,
        [],
        undefined,
      );
    });

    it('rejects a non-uint32 interfaceId via the tool wrapper', async () => {
      const response = await handlers.handleMojoEncodeMessageTool({
        interfaceName: 'network.mojom.NetworkService',
        messageType: 1,
        fields: [],
        header: { interfaceId: -1 },
      });
      const payload = ResponseBuilder.parse<Record<string, unknown>>(response);
      expect(payload).toMatchObject({ success: false });
      expect(String(payload['error'])).toContain('interfaceId');
    });

    it('rejects a non-numeric requestId via the tool wrapper', async () => {
      const response = await handlers.handleMojoEncodeMessageTool({
        interfaceName: 'network.mojom.NetworkService',
        messageType: 1,
        fields: [],
        header: { requestId: 'not-a-number' },
      });
      const payload = ResponseBuilder.parse<Record<string, unknown>>(response);
      expect(payload).toMatchObject({ success: false });
      expect(String(payload['error'])).toContain('requestId');
    });

    it('rejects an out-of-range uint64 requestId', async () => {
      const response = await handlers.handleMojoEncodeMessageTool({
        interfaceName: 'network.mojom.NetworkService',
        messageType: 1,
        fields: [],
        header: { requestId: '18446744073709551616' }, // 2^64
      });
      const payload = ResponseBuilder.parse<Record<string, unknown>>(response);
      expect(payload).toMatchObject({ success: false });
      expect(String(payload['error'])).toContain('requestId');
    });
  });
});
