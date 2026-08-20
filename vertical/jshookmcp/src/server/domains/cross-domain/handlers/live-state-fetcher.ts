import type { MCPServerContext } from '@server/domains/shared/registry';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';

interface LiveStateSource {
  tool: string;
  fetched: boolean;
  count?: number;
  error?: string;
}

export interface LiveStateFetchResult {
  args: Record<string, unknown>;
  errors: string[];
  sources: Record<string, LiveStateSource>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const raw = value[key];
  return isRecord(raw) ? raw : null;
}

function unwrapData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = nestedRecord(payload, 'data');
  return data ?? payload;
}

function responseJson(response: ToolResponse): Record<string, unknown> {
  return ResponseBuilder.parse<Record<string, unknown>>(response);
}

function pickArray(payload: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  const data = unwrapData(payload);
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeMojoMessages(value: unknown): Record<string, unknown>[] {
  return recordArray(value).map((message, index) => {
    const interfaceName = readString(message['interface'], readString(message['interfaceName']));
    const method = readString(message['method'], readString(message['messageType']));
    const timestamp = readNumber(message['timestamp'], Date.now());
    const messageId = readString(
      message['messageId'],
      `${interfaceName || 'mojo'}:${method || 'message'}:${timestamp}:${index}`,
    );
    return {
      ...message,
      interface: interfaceName,
      method,
      timestamp,
      messageId,
    };
  });
}

function normalizeNetworkRequests(value: unknown): Record<string, unknown>[] {
  return recordArray(value).map((request, index) => ({
    ...request,
    requestId: readString(request['requestId'], `network:${index}`),
    url: readString(request['url']),
    timestamp: readNumber(request['timestamp']),
  }));
}

function normalizeSyscallEvents(value: unknown): Record<string, unknown>[] {
  return recordArray(value).map((event) => ({
    ...event,
    syscallName: readString(event['syscallName'], readString(event['syscall'])),
    timestamp: readNumber(event['timestamp']),
    tid: readNumber(event['tid'], readNumber(event['threadId'], readNumber(event['pid']))),
    pid: readNumber(event['pid']),
  }));
}

function normalizeJsStacks(value: unknown): Record<string, unknown>[] {
  return recordArray(value).map((item) => {
    const syscall = isRecord(item['syscall']) ? item['syscall'] : item;
    const rawFrames = Array.isArray(item['stack'])
      ? item['stack']
      : Array.isArray(item['frames'])
        ? item['frames']
        : [];
    const frames = recordArray(rawFrames).map((frame) => ({
      functionName: readString(frame['functionName'], '<anonymous>'),
    }));
    return {
      threadId: readNumber(
        syscall['tid'],
        readNumber(syscall['threadId'], readNumber(syscall['pid'])),
      ),
      timestamp: readNumber(syscall['timestamp']),
      frames,
    };
  });
}

export class LiveStateFetcher {
  constructor(private readonly ctx?: MCPServerContext) {}

  async hydrate(args: Record<string, unknown>): Promise<LiveStateFetchResult> {
    const hydrated = { ...args };
    const errors: string[] = [];
    const sources: Record<string, LiveStateSource> = {};

    await this.fetchIfMissing(
      hydrated,
      sources,
      errors,
      'sceneTree',
      'skia_extract_scene',
      {},
      (p) => {
        const sceneTree = unwrapData(p)['sceneTree'];
        return isRecord(sceneTree) ? sceneTree : { layers: [], drawCommands: [] };
      },
    );

    await this.fetchIfMissing(
      hydrated,
      sources,
      errors,
      'mojoMessages',
      'mojo_messages_get',
      { limit: 1000 },
      (p) => normalizeMojoMessages(pickArray(p, ['messages'])),
    );

    await this.fetchIfMissing(
      hydrated,
      sources,
      errors,
      'networkRequests',
      'network_get_requests',
      { limit: 1000, autoEnable: false },
      (p) => normalizeNetworkRequests(pickArray(p, ['requests'])),
    );

    await this.fetchIfMissing(
      hydrated,
      sources,
      errors,
      'syscallEvents',
      'syscall_capture_events',
      {},
      (p) => normalizeSyscallEvents(pickArray(p, ['events'])),
    );

    await this.fetchIfMissing(
      hydrated,
      sources,
      errors,
      'jsStacks',
      'syscall_stack_capture',
      { maxEvents: 100, useDebugger: true },
      (p) => normalizeJsStacks(pickArray(p, ['events'])),
    );

    if (this.isMissing(hydrated, 'ghidraOutput')) {
      const binaryPath = readString(hydrated['binaryPath'], readString(hydrated['filePath']));
      if (binaryPath) {
        await this.fetchIfMissing(
          hydrated,
          sources,
          errors,
          'ghidraOutput',
          'ghidra_analyze',
          { binaryPath },
          (p) => unwrapData(p),
        );
      }
    }

    return { args: hydrated, errors, sources };
  }

  private async fetchIfMissing(
    args: Record<string, unknown>,
    sources: Record<string, LiveStateSource>,
    errors: string[],
    key: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    parse: (payload: Record<string, unknown>) => unknown,
  ): Promise<void> {
    if (!this.isMissing(args, key)) return;
    if (!this.ctx) {
      const error = 'MCPServerContext unavailable for live domain fetch';
      sources[key] = { tool: toolName, fetched: false, error };
      errors.push(`${key}: ${error}`);
      return;
    }

    try {
      const payload = responseJson(await this.ctx.executeToolWithTracking(toolName, toolArgs));
      const parsed = parse(payload);
      args[key] = parsed;
      sources[key] = {
        tool: toolName,
        fetched: true,
        count: Array.isArray(parsed) ? parsed.length : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sources[key] = { tool: toolName, fetched: false, error: message };
      errors.push(`${key}: ${message}`);
      args[key] = this.emptyValueFor(key);
    }
  }

  private isMissing(args: Record<string, unknown>, key: string): boolean {
    return args[key] === undefined || args[key] === null;
  }

  private emptyValueFor(key: string): unknown {
    return key === 'sceneTree' ? { layers: [], drawCommands: [] } : [];
  }
}
