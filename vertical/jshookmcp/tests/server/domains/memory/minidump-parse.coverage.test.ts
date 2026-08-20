/**
 * Coverage tests for MinidumpHandlers.handleMemoryParseDump — exercises the
 * include* flags, memory-range truncation, and address resolution, with the
 * underlying parseMinidump / resolveAddressBatch mocked. Results are wrapped
 * in a ToolResponse by handleSafe, so the JSON body is extracted per test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockParseMinidump = vi.fn();
const mockResolveAddressBatch = vi.fn();

vi.mock('@native/MinidumpParser', () => ({
  parseMinidump: (...args: unknown[]) => mockParseMinidump(...args),
  resolveAddressBatch: (...args: unknown[]) => mockResolveAddressBatch(...args),
}));

import { MinidumpHandlers } from '@server/domains/memory/handlers/minidump-parse';

function body(r: unknown) {
  // Double-cast: the handler returns Promise<unknown>; the real ToolResponse
  // content is a union (text/image/...) we don't need to model here. Return
  // type inferred as any (from JSON.parse) so nested access works in tests.
  const resp = r as unknown as { content?: Array<{ text?: string }> };
  return JSON.parse(resp.content?.[0]?.text ?? '{}');
}

function okSummary(over: Record<string, unknown> = {}) {
  return {
    success: true,
    filePath: '/x.dmp',
    fileSize: 100,
    streamCount: 2,
    streams: [{ streamName: 'SystemInfoStream', size: 56 }],
    modules: [{ name: 'libfoo' }],
    threads: [{ threadId: 1 }],
    memoryRanges: Array.from({ length: 3 }, (_, i) => ({
      startAddress: `0x${i}`,
      size: 10,
      dataOffset: 0,
    })),
    systemInfo: { processorArchitecture: 'x64' },
    exception: { exceptionCode: '0xC0000005' },
    hasMemory64: false,
    ...over,
  };
}

beforeEach(() => {
  mockParseMinidump.mockReset();
  mockResolveAddressBatch.mockReset();
});

describe('MinidumpHandlers.handleMemoryParseDump', () => {
  it('returns an error response when filePath is missing', async () => {
    const r = await new MinidumpHandlers().handleMemoryParseDump({});
    expect(body(r).error).toMatch(/filePath is required/);
  });

  it('returns success=false when parseMinidump fails', async () => {
    mockParseMinidump.mockReturnValue({ success: false, error: 'bad sig' });
    const r = await new MinidumpHandlers().handleMemoryParseDump({ filePath: '/bad.dmp' });
    expect(body(r).success).toBe(false);
    expect(body(r).error).toBe('bad sig');
  });

  it('includes modules / threads / memory / systemInfo / exception by default', async () => {
    mockParseMinidump.mockReturnValue(okSummary());
    const r = body(await new MinidumpHandlers().handleMemoryParseDump({ filePath: '/x.dmp' }));
    expect(r.success).toBe(true);
    expect(r.moduleCount).toBe(1);
    expect(r.threadCount).toBe(1);
    expect(r.memoryRangeCount).toBe(3);
    expect(r.hasMemory64).toBe(false);
    expect(r.systemInfo).toBeDefined();
    expect(r.exception).toBeDefined();
  });

  it('omits sections when their include flag is false', async () => {
    mockParseMinidump.mockReturnValue(okSummary());
    const r = body(
      await new MinidumpHandlers().handleMemoryParseDump({
        filePath: '/x.dmp',
        includeModules: false,
        includeThreads: false,
        includeMemoryRanges: false,
        includeException: false,
        includeSystemInfo: false,
      }),
    );
    expect(r.modules).toBeUndefined();
    expect(r.threads).toBeUndefined();
    expect(r.memoryRanges).toBeUndefined();
    expect(r.exception).toBeUndefined();
    expect(r.systemInfo).toBeUndefined();
  });

  it('truncates memory ranges > 500 + sets memoryRangeTruncated', async () => {
    mockParseMinidump.mockReturnValue(
      okSummary({
        memoryRanges: Array.from({ length: 600 }, (_, i) => ({
          startAddress: `0x${i}`,
          size: 1,
          dataOffset: 0,
        })),
      }),
    );
    const r = body(await new MinidumpHandlers().handleMemoryParseDump({ filePath: '/x.dmp' }));
    expect((r.memoryRanges as unknown[]).length).toBe(500);
    expect(r.memoryRangeCount).toBe(600);
    expect(r.memoryRangeTruncated).toBe(true);
  });

  it('resolves addresses when resolveAddresses is provided', async () => {
    mockParseMinidump.mockReturnValue(okSummary());
    mockResolveAddressBatch.mockReturnValue([
      { address: '0x1000', found: true, moduleName: 'libfoo' },
      { address: '0x2000', found: false },
    ]);
    const r = body(
      await new MinidumpHandlers().handleMemoryParseDump({
        filePath: '/x.dmp',
        resolveAddresses: ['0x1000', '0x2000'],
      }),
    );
    expect(r.resolvedCount).toBe(1);
    expect(r.totalQueried).toBe(2);
    expect(Array.isArray(r.addressResolutions)).toBe(true);
  });
});
