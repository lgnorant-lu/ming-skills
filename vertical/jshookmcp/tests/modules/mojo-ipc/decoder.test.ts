import { beforeEach, describe, expect, it } from 'vitest';
import { MojoDecoder } from '@modules/mojo-ipc';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('MojoDecoder', () => {
  let decoder: MojoDecoder;

  beforeEach(() => {
    decoder = new MojoDecoder();
  });

  it('normalizes hex input', () => {
    expect(decoder.cleanHex('00 01 0')).toBe('000010');
  });

  it('decodes a short payload into header and raw summary', () => {
    const decoded = decoder.decodePayload('0001', 'test');
    expect(decoded.header.version).toBe(0);
    expect(decoded.raw).toBe('0001');
    expect(decoded._raw_summary).toBeDefined();
  });

  it('decodes boolean, integer and string fields', () => {
    const encoded = decoder.encodeMessage('network.mojom.NetworkService', '1', [true, 42, 'hello']);
    const decoded = decoder.decodePayload(encoded, 'network');
    expect(decoded.fields.field0).toBe(true);
    expect(decoded.fields.field1).toBe(42);
    expect(decoded.fields.field2).toBe('hello');
  });

  it('labels known interface fields when decode context is provided', () => {
    const encoded = decoder.encodeMessage(
      'network.mojom.URLLoaderFactory',
      'CreateLoaderAndStart',
      [
        { type: 'uint32', value: 7 },
        { type: 'uint32', value: 99 },
        { type: 'uint32', value: 0 },
        {
          type: 'struct',
          fields: [
            { type: 'string', value: 'GET' },
            { type: 'string', value: withPath(TEST_URLS.root, 'api') },
          ],
        },
        { type: 'pending_remote', handle: 12 },
        { type: 'uint32', value: 1234 },
      ],
    );

    const decoded = decoder.decodePayload(encoded, {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
    });

    expect(decoded.fields.routingId).toBe(7);
    expect(decoded.fields.requestId).toBe(99);
    expect(decoded.fields.options).toBe(0);
    expect(decoded.fields.request).toEqual({
      field0: 'GET',
      field1: withPath(TEST_URLS.root, 'api'),
    });
    expect(decoded.fields.client).toEqual({ kind: 'pending_remote', handle: 12 });
    expect(decoded.fields.trafficAnnotation).toBe(1234);
    expect(decoded._raw_summary).toContain('network.mojom.URLLoaderFactory.CreateLoaderAndStart');
  });

  it('round-trips typed primitive fields', () => {
    const encoded = decoder.encodeMessage('network.mojom.NetworkService', '0x22', [
      { type: 'int16', value: -2 },
      { type: 'uint16', value: 65535 },
      { type: 'int32', value: -42 },
      { type: 'uint32', value: 42 },
      { type: 'int64', value: '-9007199254740991' },
      { type: 'uint64', value: '9007199254740991' },
      { type: 'float', value: 1.5 },
      { type: 'double', value: 2.25 },
      { type: 'nullableString', value: null },
    ]);

    const decoded = decoder.decodePayload(encoded);
    expect(decoded.header.messageType).toBe(0x22);
    expect(decoded.fields.field0).toBe(-2);
    expect(decoded.fields.field1).toBe(65535);
    expect(decoded.fields.field2).toBe(-42);
    expect(decoded.fields.field3).toBe(42);
    expect(decoded.fields.field4).toBe(-9007199254740991n);
    expect(decoded.fields.field5).toBe(9007199254740991n);
    expect(decoded.fields.field6).toBeCloseTo(1.5);
    expect(decoded.fields.field7).toBe(2.25);
    expect(decoded.fields.field8).toBeNull();
  });

  it('round-trips arrays, structs, and handle-like typed fields', () => {
    const encoded = decoder.encodeMessage('network.mojom.URLLoaderFactory', 'CreateLoader', [
      { type: 'array', elementType: 'uint16', values: [1, 65535] },
      {
        type: 'struct',
        fields: [
          { type: 'bool', value: true },
          { type: 'string', value: 'nested' },
          { type: 'handle', handle: 9 },
        ],
      },
      { type: 'pending_remote', handle: 12 },
    ]);

    const decoded = decoder.decodePayload(encoded);
    expect(decoded.fields.field0).toEqual([1, 65535]);
    expect(decoded.fields.field1).toEqual({
      field0: true,
      field1: 'nested',
      field2: { handle: 9 },
    });
    expect(decoded.fields.field2).toEqual({ kind: 'pending_remote', handle: 12 });
    expect(decoded.handles).toBe(2);
  });

  it('decodes payloads with a v2 extended header', () => {
    const decoded = decoder.decodePayload('0200030100000000000000000000000000000101');
    expect(decoded.header.version).toBe(2);
    expect(decoded.header.headerSize).toBe(18);
    expect(decoded.header.interfaceId).toBe(0);
    expect(decoded.header.requestId).toBe(0n);
    expect(decoded.fields.field0).toBe(true);
  });

  it('surfaces v2 interface id, request id, and semantic flags', () => {
    const decoded = decoder.decodePayload('0203070100007856341208070605040302010101');
    expect(decoded.header.version).toBe(2);
    expect(decoded.header.headerSize).toBe(18);
    expect(decoded.header.interfaceId).toBe(0x12345678);
    expect(decoded.header.requestId).toBe(0x0102030405060708n);
    expect(decoded.header.expectsResponse).toBe(true);
    expect(decoded.header.isResponse).toBe(true);
    expect(decoded.header.isSync).toBe(false);
    expect(decoded.header.flagNames).toEqual(['expects_response', 'is_response']);
    expect(decoded.fields.field0).toBe(true);
  });

  it('records unknown field types and continues when bytes can be skipped', () => {
    const decoded = decoder.decodePayload('010001020000feaa0101');
    expect(decoded.fields.field0).toEqual({ unknownType: 0xfe, skippedBytes: 1 });
    expect(decoded.fields.field1).toBe(true);
    expect(decoded._raw_summary).toContain('unknown field type 0xfe');
  });

  it('encodes handle fields and reports handle count', () => {
    const encoded = decoder.encodeMessage('network.mojom.NetworkService', '2', [{ handle: 5 }]);
    const decoded = decoder.decodePayload(encoded);
    expect(decoded.handles).toBe(1);
    expect(decoded.fields.field0).toEqual({ handle: 5 });
  });

  it('emits a v2 header when response/sync flags are requested', () => {
    const encoded = decoder.encodeMessage(
      'network.mojom.URLLoaderClient',
      'OnReceiveResponse',
      [{ type: 'uint32', value: 200 }],
      { isResponse: true, interfaceId: 0xdeadbeef, requestId: 0x0102030405060708n },
    );
    // 18-byte header + 5-byte uint32 field
    expect(encoded.slice(0, 2)).toBe('02'); // version=2
    expect(encoded.slice(2, 4)).toBe('02'); // flags=0x02 (is_response)
    const decoded = decoder.decodePayload(encoded);
    expect(decoded.header.version).toBe(2);
    expect(decoded.header.headerSize).toBe(18);
    expect(decoded.header.isResponse).toBe(true);
    expect(decoded.header.expectsResponse).toBe(false);
    expect(decoded.header.isSync).toBe(false);
    expect(decoded.header.flagNames).toEqual(['is_response']);
    expect(decoded.header.interfaceId).toBe(0xdeadbeef);
    expect(decoded.header.requestId).toBe(0x0102030405060708n);
    expect(decoded.fields.field0).toBe(200);
  });

  it('emits a v2 header for sync + expectsResponse with a numeric requestId', () => {
    const encoded = decoder.encodeMessage(
      'network.mojom.URLLoaderFactory',
      'CreateLoaderAndStart',
      [{ type: 'bool', value: true }],
      { expectsResponse: true, isSync: true, requestId: 42 },
    );
    const decoded = decoder.decodePayload(encoded);
    expect(decoded.header.headerSize).toBe(18);
    expect(decoded.header.expectsResponse).toBe(true);
    expect(decoded.header.isSync).toBe(true);
    expect(decoded.header.isResponse).toBe(false);
    expect(decoded.header.flagNames).toEqual(['expects_response', 'is_sync']);
    expect(decoded.header.requestId).toBe(42n);
    expect(decoded.fields.field0).toBe(true);
  });

  it('accepts a numeric-string requestId and round-trips it as uint64', () => {
    const big = '9007199254740993'; // >2^53, lossy as Number, safe as BigInt
    const encoded = decoder.encodeMessage(
      'network.mojom.NetworkService',
      '5',
      [{ type: 'uint16', value: 1 }],
      { requestId: big },
    );
    const decoded = decoder.decodePayload(encoded);
    expect(decoded.header.headerSize).toBe(18);
    expect(decoded.header.requestId).toBe(9007199254740993n);
  });

  it('stays on the 6-byte v1 header when no options are provided', () => {
    const encoded = decoder.encodeMessage('network.mojom.NetworkService', '2', [
      { type: 'uint32', value: 7 },
    ]);
    const decoded = decoder.decodePayload(encoded);
    expect(decoded.header.version).toBe(1);
    expect(decoded.header.headerSize).toBe(6);
    expect(decoded.header.interfaceId).toBeUndefined();
    expect(decoded.header.requestId).toBeUndefined();
  });
});
