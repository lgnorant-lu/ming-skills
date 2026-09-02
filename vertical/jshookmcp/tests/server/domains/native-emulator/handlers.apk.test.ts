/**
 * NativeEmulatorHandlers — APK extraction handlers.
 *
 * The architecture review called out `nemu_extract_apk_libs` /
 * `nemu_load_apk_library` silently dropping the `truncated` flag from the
 * detailed extractor: a zip-bomb-sized APK would surface a misleading
 * "library not found" instead of "extraction truncated at the cap". These
 * tests pin the wiring: the detailed result's `truncated`/`totalBytes` must
 * reach the response, and a truncated extraction must report the truncation
 * reason rather than a not-found error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@modules/native-emulator/apk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modules/native-emulator/apk')>();
  return {
    ...actual,
    extractArm64LibsDetailed: vi.fn(),
  };
});

import { extractArm64LibsDetailed } from '@modules/native-emulator/apk';
import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers.impl';
import { SessionManager } from '@modules/native-emulator/SessionManager';

const mockedExtractDetailed = vi.mocked(extractArm64LibsDetailed);

/** Parse the JSON payload out of an MCP text response. */
function payload(res: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = res.content.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

describe('NativeEmulatorHandlers — APK extraction', () => {
  let handlers: NativeEmulatorHandlers | undefined;

  afterEach(() => {
    handlers?.dispose();
    handlers = undefined;
    vi.clearAllMocks();
  });

  it('handleExtractApkLibs surfaces truncated and totalBytes from the detailed result', async () => {
    mockedExtractDetailed.mockResolvedValue({
      libs: [{ name: 'liba.so', bytes: new Uint8Array([1, 2, 3]) }],
      truncated: true,
      totalBytes: 12345,
    });
    handlers = new NativeEmulatorHandlers();
    const data = payload(await handlers.handleExtractApkLibs({ apkPath: '/tmp/app.apk' }));

    expect(data.success).toBe(true);
    expect(data.truncated).toBe(true);
    expect(data.totalBytes).toBe(12345);
    expect(data.libs).toEqual([{ name: 'liba.so', bytes: 3 }]);
    expect(data.count).toBe(1);
  });

  it('handleExtractApkLibs reports truncated=false when the cap was not reached', async () => {
    mockedExtractDetailed.mockResolvedValue({
      libs: [{ name: 'liba.so', bytes: new Uint8Array([1, 2, 3]) }],
      truncated: false,
      totalBytes: 3,
    });
    handlers = new NativeEmulatorHandlers();
    const data = payload(await handlers.handleExtractApkLibs({ apkPath: '/tmp/app.apk' }));

    expect(data.success).toBe(true);
    expect(data.truncated).toBe(false);
    expect(data.totalBytes).toBe(3);
  });

  it('handleLoadApkLibrary reports the truncation reason instead of not-found', async () => {
    mockedExtractDetailed.mockResolvedValue({
      libs: [{ name: 'liba.so', bytes: new Uint8Array([1, 2, 3]) }],
      truncated: true,
      totalBytes: 512 * 1024 * 1024,
    });
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const created = payload(await handlers.handleCreateSession({ installSyscalls: false }));
    const sessionId = created.sessionId as string;

    const data = payload(
      await handlers.handleLoadApkLibrary({
        sessionId,
        apkPath: '/tmp/app.apk',
        libName: 'liba.so',
      }),
    );

    expect(data.success).toBe(false);
    expect(data.error).toContain('truncated');
    expect(data.error).toContain('MB cap');
  });
});
