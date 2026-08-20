import { describe, expect, it } from 'vitest';
import {
  extractCDPEvents,
  extractGhidraOutput,
  extractJSObjectArray,
  extractJSStacks,
  extractMojoMessages,
  extractNetworkRequests,
  extractSkiaSceneTree,
  extractSyscallEvents,
} from '@server/domains/cross-domain/handlers/input-extractors';

describe('cross-domain input extractors', () => {
  it('normalizes malformed skia and js object input without throwing', () => {
    expect(extractSkiaSceneTree(null)).toEqual({ layers: [], drawCommands: [] });
    expect(
      extractJSObjectArray([
        {
          objectId: '1',
          className: 'Sprite',
          name: 1,
          stringProps: ['ok', 1],
          numericProps: { width: 10, bad: 'x' },
          colorProps: 'nope',
          urlProps: ['https://a', false],
        },
        null,
      ]),
    ).toEqual([
      {
        objectId: '1',
        className: 'Sprite',
        name: '',
        stringProps: ['ok'],
        numericProps: { width: 10 },
        colorProps: [],
        urlProps: ['https://a'],
      },
    ]);
  });

  it('keeps optional fields optional while defaulting invalid scalar values', () => {
    expect(extractCDPEvents([{ eventType: 'request', timestamp: 'bad', url: 1 }])).toEqual([
      { eventType: 'request', timestamp: 0, url: undefined },
    ]);

    expect(extractNetworkRequests([{ requestId: 1, url: 'https://a', timestamp: 5 }])).toEqual([
      { requestId: '', url: 'https://a', timestamp: 5 },
    ]);

    expect(
      extractMojoMessages([{ interface: 'Foo', method: 1, timestamp: 9, messageId: [] }]),
    ).toEqual([{ interface: 'Foo', method: '', timestamp: 9, messageId: '' }]);

    expect(
      extractSyscallEvents([{ pid: 1, tid: 'bad', syscallName: 'open', timestamp: 2 }]),
    ).toEqual([{ pid: 1, tid: 0, syscallName: 'open', timestamp: 2 }]);
  });

  it('preserves frame arrays and optional ghidra fields at the boundary', () => {
    expect(
      extractJSStacks([{ threadId: 7, timestamp: 9, frames: [{ functionName: 'main' }, {}] }]),
    ).toEqual([
      { threadId: 7, timestamp: 9, frames: [{ functionName: 'main' }, { functionName: '' }] },
    ]);

    expect(
      extractGhidraOutput({
        moduleName: 'libfoo.so',
        functions: [{ name: 'fn', moduleName: 'libfoo.so', address: 1, calledFrom: ['a', 2] }],
      }),
    ).toEqual({
      moduleName: 'libfoo.so',
      functions: [{ name: 'fn', moduleName: 'libfoo.so', address: undefined, calledFrom: ['a'] }],
    });

    expect(extractGhidraOutput({ moduleName: 1 })).toBeNull();
  });
});
