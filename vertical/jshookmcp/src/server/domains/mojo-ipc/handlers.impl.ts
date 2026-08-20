import {
  type MojoEncodeOptions,
  type MojoMessageDirection,
  MojoDecoder,
  MojoMonitor,
} from '@modules/mojo-ipc';
import { buildVerifyLiveScript } from '@modules/mojo-ipc/symbol-db';
import {
  capabilityFailure,
  capabilityReport,
  createStub,
} from '@server/domains/shared/capabilities';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import {
  argArray,
  argBool,
  argEnum,
  argNumber,
  argString,
} from '@server/domains/shared/parse-args';
import type { EventBus, ServerEventMap } from '@server/EventBus';

const DIRECTION_SET: ReadonlySet<MojoMessageDirection> = new Set<MojoMessageDirection>([
  'request',
  'response',
  'sync',
]);

function getMojoFix(reason: string): string {
  return reason.includes('JSHOOK_ENABLE_MOJO_IPC')
    ? 'Unset JSHOOK_ENABLE_MOJO_IPC or set it to 1, then retry.'
    : 'Install Frida and ensure the Chromium target is running.';
}

function unavailablePayload(reason: string, tool: string): Record<string, unknown> {
  return {
    ...capabilityFailure(tool, 'mojo_ipc_monitoring', reason, getMojoFix(reason)),
    error: reason,
  };
}

const LIVE_CAPTURE_REASON =
  'Live capture requires Frida attached to a Chromium target whose build exports a Mojo write-path symbol ' +
  '(MojoWriteMessage/MojoWriteMessageNew). The hook script ships with real Interceptor.attach logic, but the ' +
  'symbol is Chromium-version-specific and not verified in CI; without a matching target the monitor stays simulated.';
const LIVE_CAPTURE_FIX =
  'Attach Frida to a Chromium process whose Mojo write-path export resolves; the monitor flips out of simulation ' +
  'once the first real message is captured.';

function getFridaProbeSucceeded(monitor: MojoMonitor): boolean {
  const maybeMonitor = monitor as MojoMonitor & { didFridaProbeSucceed?: () => boolean };
  return typeof maybeMonitor.didFridaProbeSucceed === 'function'
    ? maybeMonitor.didFridaProbeSucceed()
    : false;
}

function argStringOrNumber(
  args: Record<string, unknown>,
  key: string,
): string | number | undefined {
  const value = args[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        toJsonSafe(item),
      ]),
    );
  }

  return value;
}

export class MojoIPCHandlers {
  constructor(
    private monitor?: MojoMonitor,
    private decoder?: MojoDecoder,
    private eventBus?: EventBus<ServerEventMap>,
  ) {}

  async handleMojoMonitorDispatchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoMonitorDispatch(args));
  }

  async handleMojoIpcCapabilitiesTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoIpcCapabilities());
  }

  async handleMojoDecodeMessageTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoDecodeMessage(args));
  }

  async handleMojoEncodeMessageTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoEncodeMessage(args));
  }

  async handleMojoListInterfacesTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoListInterfaces());
  }

  async handleMojoMessagesGetTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoMessagesGet(args));
  }

  async handleMojoMessagesSummarizeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoMessagesSummarize(args));
  }

  async handleMojoMonitorDispatch(args: Record<string, unknown>): Promise<unknown> {
    return String(args['action'] ?? '') === 'stop'
      ? this.handleMojoMonitorStop()
      : this.handleMojoMonitorStart(args);
  }

  async handleMojoIpcCapabilities(): Promise<unknown> {
    const monitor = this.getMonitor();
    const fridaProbeSucceeded = getFridaProbeSucceeded(monitor);
    const availability =
      typeof monitor.probeAvailability === 'function'
        ? await monitor.probeAvailability()
        : {
            available: monitor.isAvailable(),
            reason: monitor.getUnavailableReason(),
            fridaAvailable: monitor.isAvailable(),
            fridaCliAvailable: false,
          };

    return capabilityReport('mojo_ipc_capabilities', [
      {
        capability: 'mojo_ipc_monitoring',
        status: availability.available ? 'available' : 'unavailable',
        reason: availability.reason,
        fix: availability.available ? undefined : getMojoFix(availability.reason ?? ''),
        details: {
          tools: [
            'mojo_monitor',
            'mojo_list_interfaces',
            'mojo_messages_get',
            'mojo_messages_summarize',
          ],
          fridaAvailable: availability.fridaAvailable,
          fridaCliAvailable: availability.fridaCliAvailable,
          fridaProbeSucceeded,
          active: monitor.isActive(),
          simulationMode: monitor.isSimulationMode(),
          interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
          liveCaptureImplemented: true,
          liveCaptureVerified: false,
        },
      },
      {
        capability: 'mojo_live_capture',
        status: monitor.isLiveCapture() ? 'available' : 'unavailable',
        reason: monitor.isLiveCapture() ? undefined : LIVE_CAPTURE_REASON,
        fix: monitor.isLiveCapture() ? undefined : LIVE_CAPTURE_FIX,
        details: {
          tools: [
            'mojo_monitor',
            'mojo_list_interfaces',
            'mojo_messages_get',
            'mojo_messages_summarize',
          ],
          fridaAvailable: availability.fridaAvailable,
          fridaCliAvailable: availability.fridaCliAvailable,
          fridaProbeSucceeded,
          active: monitor.isActive(),
          simulationMode: monitor.isSimulationMode(),
          interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
          fallbackMode: availability.available ? 'simulation' : 'none',
          liveCaptureImplemented: true,
          liveCaptureVerified: false,
        },
      },
      {
        capability: 'mojo_payload_decode',
        status: 'available',
        details: {
          tools: ['mojo_decode_message', 'mojo_encode_message'],
        },
      },
    ]);
  }

  async handleMojoMonitorStart(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.getMonitor();
    const deviceId = argString(args, 'deviceId');
    await monitor.start(deviceId);

    if (!monitor.isAvailable()) {
      return unavailablePayload(
        monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
        'mojo_monitor',
      );
    }

    const isSimulation = monitor.isSimulationMode();

    if (isSimulation) {
      return createStub({
        tool: 'mojo_monitor',
        stubType: 'simulated',
        reason: 'Real Frida-backed message capture is not active',
        fix: 'Install Frida and attach to a Chromium target with Mojo IPC traffic',
        data: {
          available: true,
          started: monitor.isActive(),
          deviceId: monitor.getDeviceId() ?? null,
          simulation: true, // Keep for backward compatibility
          interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
        },
        warning:
          'Mojo IPC monitor is running in simulation mode. Real Frida-backed message capture is not active.',
      });
    }

    return {
      success: true,
      available: true,
      started: monitor.isActive(),
      deviceId: monitor.getDeviceId() ?? null,
      simulation: false,
      interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
      observedInterfaceCount: monitor.getObservedInterfaceCount(),
    };
  }

  async handleMojoMonitorStop(): Promise<unknown> {
    const monitor = this.getMonitor();
    if (!monitor.isAvailable()) {
      return unavailablePayload(
        monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
        'mojo_monitor',
      );
    }

    await monitor.stop();

    return {
      success: true,
      available: true,
      started: false,
      simulation: monitor.isSimulationMode(),
    };
  }

  async handleMojoDecodeMessage(args: Record<string, unknown>): Promise<unknown> {
    const hexPayload = argString(args, 'hexPayload', '');
    if (hexPayload.length === 0) {
      return {
        success: false,
        error: 'hexPayload is required',
      };
    }

    const interfaceName = argString(args, 'interfaceName')?.trim();
    const messageType = argStringOrNumber(args, 'messageType');
    const decoded =
      interfaceName || messageType !== undefined
        ? this.getDecoder().decodePayload(hexPayload, { interfaceName, messageType })
        : this.getDecoder().decodePayload(hexPayload);
    return {
      success: true,
      decoded: toJsonSafe(decoded),
    };
  }

  async handleMojoEncodeMessage(args: Record<string, unknown>): Promise<unknown> {
    const interfaceName = argString(args, 'interfaceName', '').trim();
    if (interfaceName.length === 0) {
      return {
        success: false,
        error: 'interfaceName is required',
      };
    }

    const messageType = argStringOrNumber(args, 'messageType');
    if (
      messageType === undefined ||
      (typeof messageType === 'string' && messageType.trim().length === 0) ||
      (typeof messageType === 'number' && !Number.isFinite(messageType))
    ) {
      return {
        success: false,
        error: 'messageType is required',
      };
    }

    const fields = argArray(args, 'fields');
    if (!fields) {
      return {
        success: false,
        error: 'fields must be an array',
      };
    }

    const headerOptions = this.resolveEncodeHeader(args['header']);
    const hexPayload = this.getDecoder().encodeMessage(
      interfaceName,
      messageType,
      fields,
      headerOptions,
    );
    return {
      success: true,
      hexPayload,
    };
  }

  /**
   * Translate the optional `header` tool arg into MojoEncodeOptions. Returns
   * undefined when no v2 field/flag is set so the encoder emits the default
   * 6-byte v1 header (backward compatible). requestId is accepted as number or
   * numeric string; a non-numeric string surfaces a clear error via handleSafe.
   */
  private resolveEncodeHeader(raw: unknown): MojoEncodeOptions | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return undefined;
    }
    const header = raw as Record<string, unknown>;
    const options: MojoEncodeOptions = {};
    const expectsResponse = argBool(header, 'expectsResponse');
    if (expectsResponse !== undefined) options.expectsResponse = expectsResponse;
    const isResponse = argBool(header, 'isResponse');
    if (isResponse !== undefined) options.isResponse = isResponse;
    const isSync = argBool(header, 'isSync');
    if (isSync !== undefined) options.isSync = isSync;
    const interfaceId = argNumber(header, 'interfaceId');
    if (interfaceId !== undefined) {
      if (!Number.isFinite(interfaceId) || interfaceId < 0 || interfaceId > 0xffffffff) {
        throw new Error(`header.interfaceId must be a uint32 (0..4294967295), got ${interfaceId}`);
      }
      options.interfaceId = Math.trunc(interfaceId);
    }
    const requestId = header['requestId'];
    if (requestId !== undefined) {
      if (typeof requestId !== 'number' && typeof requestId !== 'string') {
        throw new Error('header.requestId must be a number or numeric string');
      }
      // Validate it parses as a uint64-range integer before reaching BigInt().
      const asString = String(requestId);
      if (!/^-?[0-9]+$/.test(asString)) {
        throw new Error(`header.requestId must be numeric, got "${asString}"`);
      }
      const asBig = BigInt(asString);
      if (asBig < 0n || asBig > 0xffffffffffffffffn) {
        throw new Error(
          `header.requestId must fit in uint64 (0..18446744073709551615), got ${asString}`,
        );
      }
      options.requestId = asBig;
    }
    return options;
  }

  async handleMojoListInterfaces(): Promise<unknown> {
    const monitor = this.getMonitor();
    if (!monitor.isAvailable()) {
      return {
        ...unavailablePayload(
          monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
          'mojo_list_interfaces',
        ),
        interfaces: [],
      };
    }

    const isSimulation = monitor.isSimulationMode();
    const catalogSource = monitor.getInterfaceCatalogSource();
    const interfaces = await monitor.listInterfaces();

    // Use stub format when in simulation or using seeded defaults
    if (isSimulation || catalogSource === 'seeded-defaults') {
      const reason =
        catalogSource === 'seeded-defaults'
          ? 'Interface list currently comes from the seeded default catalog; no live observed Mojo interfaces have been captured yet.'
          : 'Mojo IPC monitor is running in simulation mode. Interface counts may not reflect live traffic.';

      return createStub({
        tool: 'mojo_list_interfaces',
        stubType: 'simulated',
        reason,
        fix: 'Install Frida and attach to a Chromium target to capture live Mojo interfaces',
        data: {
          available: true,
          active: monitor.isActive(),
          interfaces,
          simulation: isSimulation, // Keep for backward compatibility
          interfaceCatalogSource: catalogSource,
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
        },
        warning: reason,
      });
    }

    return {
      success: true,
      available: true,
      active: monitor.isActive(),
      interfaces,
      simulation: false,
      interfaceCatalogSource: catalogSource,
      observedInterfaceCount: monitor.getObservedInterfaceCount(),
    };
  }

  async handleMojoMessagesGet(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.getMonitor();
    if (!monitor.isAvailable()) {
      return {
        ...unavailablePayload(
          monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
          'mojo_messages_get',
        ),
        messages: [],
        totalAvailable: 0,
        filtered: false,
        simulation: true,
      };
    }

    const limit = argNumber(args, 'limit');
    const interfaceName = argString(args, 'interface');
    const messageType = argStringOrNumber(args, 'messageType');
    const sinceTimestamp = argNumber(args, 'sinceTimestamp');
    const hexSearch = argString(args, 'hexSearch');
    const direction = argEnum(args, 'direction', DIRECTION_SET);

    const result = (await monitor.getMessages({
      limit: limit !== undefined ? Math.min(limit, 10000) : 100,
      interfaceName,
      messageType,
      sinceTimestamp,
      hexSearch,
      direction,
    })) as {
      messages: unknown[];
      totalAvailable: number;
      filtered: boolean;
      simulation: boolean;
    };

    if (result.messages && Array.isArray(result.messages) && result.messages.length > 0) {
      void this.eventBus?.emit('mojo:message_captured', {
        messageCount: result.messages.length,
        timestamp: new Date().toISOString(),
      });
    }

    const isSimulation = result.simulation || monitor.isSimulationMode();

    if (isSimulation) {
      return createStub({
        tool: 'mojo_messages_get',
        stubType: 'simulated',
        reason:
          'Mojo IPC is operating in simulation mode. Messages are not captured from real Frida hooks.',
        fix: 'Install Frida for live IPC monitoring',
        data: {
          available: true,
          active: monitor.isActive(),
          messages: result.messages,
          totalAvailable: result.totalAvailable,
          filtered: result.filtered,
          simulation: true, // Keep for backward compatibility
          interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
        },
        warning:
          'Mojo IPC is operating in simulation mode. Messages are not captured from real Frida hooks. Install Frida for live IPC monitoring.',
      });
    }

    return {
      success: true,
      available: true,
      active: monitor.isActive(),
      messages: result.messages,
      totalAvailable: result.totalAvailable,
      filtered: result.filtered,
      simulation: false,
      interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
      observedInterfaceCount: monitor.getObservedInterfaceCount(),
    };
  }

  async handleMojoMessagesSummarize(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.getMonitor();
    if (!monitor.isAvailable()) {
      return {
        ...unavailablePayload(
          monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
          'mojo_messages_summarize',
        ),
        total: 0,
        byDirection: { request: 0, response: 0, sync: 0, unknown: 0 },
        byInterface: [],
        byMethod: [],
        topInterfaces: [],
        topMethods: [],
      };
    }

    const interfaceName = argString(args, 'interface');
    const messageType = argStringOrNumber(args, 'messageType');
    const sinceTimestamp = argNumber(args, 'sinceTimestamp');
    const hexSearch = argString(args, 'hexSearch');
    const direction = argEnum(args, 'direction', DIRECTION_SET);
    const topN = argNumber(args, 'topN');

    const summary = await monitor.summarizeMessages({
      interfaceName,
      messageType,
      sinceTimestamp,
      hexSearch,
      direction,
      topN,
    });

    const isSimulation = summary.simulation || monitor.isSimulationMode();
    const payload = {
      success: true,
      available: true,
      active: monitor.isActive(),
      summary: toJsonSafe(summary),
      interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
      observedInterfaceCount: monitor.getObservedInterfaceCount(),
    };

    if (isSimulation) {
      return createStub({
        tool: 'mojo_messages_summarize',
        stubType: 'simulated',
        reason:
          'Mojo IPC is operating in simulation mode. Summary reflects the seeded/simulated buffer, not real Frida-captured traffic.',
        fix: 'Install Frida for live IPC monitoring',
        data: payload,
        warning:
          'Mojo IPC is operating in simulation mode. Summary reflects the seeded/simulated buffer, not real Frida-captured traffic.',
      });
    }

    return payload;
  }

  private getMonitor(): MojoMonitor {
    if (!this.monitor) {
      this.monitor = new MojoMonitor();
    }

    return this.monitor;
  }

  private getDecoder(): MojoDecoder {
    if (!this.decoder) {
      this.decoder = new MojoDecoder();
    }

    return this.decoder;
  }

  // ── mojo_verify_live ──

  async handleMojoVerifyLiveTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const platform = argString(args, 'platform') as 'win32' | 'linux' | 'darwin' | undefined;
      if (!platform || !['win32', 'linux', 'darwin'].includes(platform)) {
        throw new Error('platform must be one of: win32, linux, darwin');
      }
      const chromiumVersion = argNumber(args, 'chromiumVersion');
      const channel = (argString(args, 'channel') ?? 'stable') as
        | 'stable'
        | 'beta'
        | 'dev'
        | 'canary';
      const targetProcess = argString(args, 'targetProcess');

      return buildVerifyLiveScript({
        platform,
        chromiumVersion,
        channel,
        targetProcess,
      });
    });
  }
}
