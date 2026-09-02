import { describe, expect, it } from 'vitest';
import {
  extractScriptLocation,
  sanitizeTracePayload,
  truncateUtf8,
  type UnknownRecord,
} from '@modules/trace/TraceRecorder.internal';

describe('extractScriptLocation', () => {
  it('preserves zero line numbers (CDP lines are 0-based)', () => {
    const location = extractScriptLocation('Runtime.consoleAPICalled', {
      scriptId: 's1',
      lineNumber: 0,
    });
    expect(location).toEqual({ scriptId: 's1', lineNumber: 0 });
  });

  it('does not coerce a missing scriptId into the string "undefined"', () => {
    const location = extractScriptLocation('Runtime.consoleAPICalled', {
      scriptId: undefined,
      lineNumber: 1,
    });
    expect(location.scriptId).toBeNull();
  });

  it('keeps the top frame location for Debugger.paused including line 0', () => {
    const location = extractScriptLocation('Debugger.paused', {
      callFrames: [{ location: { scriptId: 'f1', lineNumber: 0 } }],
    });
    expect(location).toEqual({ scriptId: 'f1', lineNumber: 0 });
  });
});

describe('truncateUtf8', () => {
  it('keeps strings within the byte budget unchanged', () => {
    expect(truncateUtf8('hello', 64)).toBe('hello');
  });

  it('never exceeds the byte budget for multi-byte strings', () => {
    const value = '😀'.repeat(2000); // 8,000 bytes
    const truncated = truncateUtf8(value, 512);
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(512);
    expect(truncated).not.toBe(value);
  });
});

describe('sanitizeTracePayload', () => {
  it('marks dataReceived chunks without inlining raw chunk data', () => {
    const result = sanitizeTracePayload('Network.dataReceived', {
      requestId: 'r1',
      data: 'raw-chunk',
    }) as UnknownRecord;
    expect(result['hasChunkData']).toBe(true);
    expect(result['chunkDataBytes']).toBe(9);
    expect(result['data']).toBe('[captured in network_chunks]');
  });

  it('truncates oversized SSE messages within the UTF-8 byte budget', () => {
    const big = '😀'.repeat(6000); // 24,000 bytes > 16 KiB budget
    const result = sanitizeTracePayload('Network.eventSourceMessageReceived', {
      data: big,
    }) as UnknownRecord;
    const data = result['data'] as string;
    expect(result['truncatedData']).toBe(true);
    expect(data.endsWith('...[truncated]')).toBe(true);
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(
      16 * 1024 + '...[truncated]'.length,
    );
  });

  it('leaves SSE messages within the budget untouched', () => {
    const result = sanitizeTracePayload('Network.eventSourceMessageReceived', {
      data: 'small message',
    }) as UnknownRecord;
    expect(result['data']).toBe('small message');
    expect(result['truncatedData']).toBeUndefined();
  });

  it('truncates oversized WebSocket payloads within the UTF-8 byte budget', () => {
    const big = 'a'.repeat(20_000);
    const result = sanitizeTracePayload('Network.webSocketFrameReceived', {
      response: { payloadData: big },
    }) as UnknownRecord;
    const response = result['response'] as UnknownRecord;
    expect(response['truncatedPayloadData']).toBe(true);
    expect(Buffer.byteLength(response['payloadData'] as string, 'utf8')).toBeLessThanOrEqual(
      16 * 1024 + '...[truncated]'.length,
    );
  });
});
