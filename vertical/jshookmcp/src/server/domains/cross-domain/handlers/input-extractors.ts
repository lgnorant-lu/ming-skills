import type { GhidraFunction, GhidraOutput } from './binary-to-js-pipeline';
import type { MojoMessage, CDPEvent, NetworkRequest } from './mojo-cdp-correlator';
import type { JSObjectDescriptor, SkiaSceneTree } from './skia-correlator';
import type { SyscallEvent, JSStack, JSStackFrame } from './syscall-js-correlator';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object';
}

function readRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
}

export function extractSkiaSceneTree(value: unknown): SkiaSceneTree {
  if (!isRecord(value)) {
    return { layers: [], drawCommands: [] };
  }

  return {
    layers: Array.isArray(value['layers']) ? value['layers'] : [],
    drawCommands: Array.isArray(value['drawCommands']) ? value['drawCommands'] : [],
  };
}

export function extractJSObjectArray(value: unknown): JSObjectDescriptor[] {
  return readRecordArray(value).map(
    (item): JSObjectDescriptor => ({
      objectId: readString(item['objectId']),
      className: readString(item['className']),
      name: readString(item['name']),
      stringProps: readStringArray(item['stringProps']),
      numericProps: readNumberRecord(item['numericProps']),
      colorProps: readStringArray(item['colorProps']),
      urlProps: readStringArray(item['urlProps']),
    }),
  );
}

export function extractMojoMessages(value: unknown): MojoMessage[] {
  return readRecordArray(value).map(
    (item): MojoMessage => ({
      interface: readString(item['interface']),
      method: readString(item['method']),
      timestamp: readNumber(item['timestamp']),
      messageId: readString(item['messageId']),
    }),
  );
}

export function extractCDPEvents(value: unknown): CDPEvent[] {
  return readRecordArray(value).map(
    (item): CDPEvent => ({
      eventType: readString(item['eventType']),
      timestamp: readNumber(item['timestamp']),
      url: readOptionalString(item['url']),
    }),
  );
}

export function extractNetworkRequests(value: unknown): NetworkRequest[] {
  return readRecordArray(value).map(
    (item): NetworkRequest => ({
      requestId: readString(item['requestId']),
      url: readString(item['url']),
      timestamp: readNumber(item['timestamp']),
    }),
  );
}

export function extractSyscallEvents(value: unknown): SyscallEvent[] {
  return readRecordArray(value).map(
    (item): SyscallEvent => ({
      pid: readNumber(item['pid']),
      tid: readNumber(item['tid']),
      syscallName: readString(item['syscallName']),
      timestamp: readNumber(item['timestamp']),
    }),
  );
}

export function extractJSStacks(value: unknown): JSStack[] {
  return readRecordArray(value).map(
    (item): JSStack => ({
      threadId: readNumber(item['threadId']),
      timestamp: readNumber(item['timestamp']),
      frames: readRecordArray(item['frames']).map(
        (frame): JSStackFrame => ({
          functionName: readString(frame['functionName']),
        }),
      ),
    }),
  );
}

export function extractGhidraOutput(value: unknown): GhidraOutput | null {
  if (!isRecord(value)) {
    return null;
  }

  const moduleName = readString(value['moduleName']);
  if (!moduleName) {
    return null;
  }

  const functions = readRecordArray(value['functions']).map(
    (item): GhidraFunction => ({
      name: readString(item['name']),
      moduleName: readString(item['moduleName']),
      address: readOptionalString(item['address']),
      calledFrom: readOptionalStringArray(item['calledFrom']),
    }),
  );

  return { functions, moduleName };
}
