/**
 * NativeEmulatorHandlers — disk-read and VFS byte caps (b3-05 / b3-06).
 *
 * `load_library` read a .so from disk with no size precheck, and the session
 * VFS `files` payload was decoded with no per-file or total byte budget. The
 * caps are env-tunable constants, so these tests reload the module graph with
 * tiny caps (a few bytes) rather than allocating hundreds of MB. Real files are
 * written for the disk-stat precheck; real base64 is decoded for the VFS
 * precheck.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_ENV = { ...process.env };

function payload(res: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = res.content.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Reload the handler module graph with the given env overrides so the NEMU_*
 * byte caps are re-evaluated to tiny values for the test.
 */
async function loadHandlers(overrides: Record<string, string | undefined> = {}): Promise<{
  NativeEmulatorHandlers: typeof import('@server/domains/native-emulator/handlers.impl').NativeEmulatorHandlers;
}> {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const mod = await import('@server/domains/native-emulator/handlers.impl');
  return { NativeEmulatorHandlers: mod.NativeEmulatorHandlers };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

let tmpDir: string;
let tinySo: string;
let depA: string;
let depB: string;
let depC: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'nemu-bounds-'));
  tinySo = join(tmpDir, 'tiny.so');
  depA = join(tmpDir, 'depA.so');
  depB = join(tmpDir, 'depB.so');
  depC = join(tmpDir, 'depC.so');
  // 11 bytes: over a 10-byte per-file cap.
  await writeFile(tinySo, Buffer.alloc(11, 0x41));
  // 4 bytes each: individually under a 10-byte per-file cap, but 3×4=12 bytes
  // exceeds a 10-byte chain-total cap.
  await writeFile(depA, Buffer.alloc(4, 0x42));
  await writeFile(depB, Buffer.alloc(4, 0x43));
  await writeFile(depC, Buffer.alloc(4, 0x44));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('native-emulator byte caps (b3-05 / b3-06)', () => {
  it('rejects load_library when the .so on-disk size exceeds the cap', async () => {
    const { NativeEmulatorHandlers } = await loadHandlers({ NEMU_MAX_SO_BYTES: '10' });
    const handlers = new NativeEmulatorHandlers();
    try {
      const session = payload(await handlers.handleCreateSession({ installSyscalls: false }));
      const sessionId = session.sessionId as string;
      const res = payload(await handlers.handleLoadLibrary({ sessionId, soPath: tinySo }));
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('exceeds');
    } finally {
      handlers.dispose();
    }
  });

  it('rejects load_library_chain when the dependency total exceeds the cap', async () => {
    const { NativeEmulatorHandlers } = await loadHandlers({ NEMU_MAX_SO_BYTES: '10' });
    const handlers = new NativeEmulatorHandlers();
    try {
      const session = payload(await handlers.handleCreateSession({ installSyscalls: false }));
      const sessionId = session.sessionId as string;
      const res = payload(
        await handlers.handleLoadLibraryChain({
          sessionId,
          dependencyPaths: [depA, depB, depC],
          primaryPath: tinySo,
        }),
      );
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('exceeds');
    } finally {
      handlers.dispose();
    }
  });

  it('rejects create_session VFS files over the per-file cap', async () => {
    const { NativeEmulatorHandlers } = await loadHandlers({
      NEMU_VFS_MAX_FILE_BYTES: '10',
      NEMU_VFS_MAX_TOTAL_BYTES: '1000',
    });
    const handlers = new NativeEmulatorHandlers();
    try {
      const big = Buffer.alloc(11).toString('base64'); // 11 bytes decoded > 10
      const res = payload(await handlers.handleCreateSession({ files: { '/tmp/big': big } }));
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('exceeds');
    } finally {
      handlers.dispose();
    }
  });

  it('rejects create_session VFS files over the total cap', async () => {
    const { NativeEmulatorHandlers } = await loadHandlers({
      NEMU_VFS_MAX_FILE_BYTES: '10',
      NEMU_VFS_MAX_TOTAL_BYTES: '10',
    });
    const handlers = new NativeEmulatorHandlers();
    try {
      const f1 = Buffer.alloc(4).toString('base64');
      const f2 = Buffer.alloc(4).toString('base64');
      const f3 = Buffer.alloc(4).toString('base64'); // 12 bytes total > 10
      const res = payload(
        await handlers.handleCreateSession({ files: { '/a': f1, '/b': f2, '/c': f3 } }),
      );
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('exceeds');
    } finally {
      handlers.dispose();
    }
  });

  it('rejects an over-cap VFS file before decoding (no base64 buffer allocation)', async () => {
    const { NativeEmulatorHandlers } = await loadHandlers({
      NEMU_VFS_MAX_FILE_BYTES: '10',
      NEMU_VFS_MAX_TOTAL_BYTES: '1000',
    });
    const fromSpy = vi.spyOn(Buffer, 'from');
    const handlers = new NativeEmulatorHandlers();
    try {
      const big = Buffer.alloc(11).toString('base64'); // 11 bytes decoded > 10
      const res = payload(await handlers.handleCreateSession({ files: { '/tmp/big': big } }));
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('exceeds');
      // The per-file cap is detected from the encoded length BEFORE Buffer.from
      // allocates a decoded buffer.
      expect(fromSpy).not.toHaveBeenCalledWith(big, 'base64');
    } finally {
      handlers.dispose();
      fromSpy.mockRestore();
    }
  });

  it('rejects an over-total VFS file before decoding the overflowing file', async () => {
    const { NativeEmulatorHandlers } = await loadHandlers({
      NEMU_VFS_MAX_FILE_BYTES: '10',
      NEMU_VFS_MAX_TOTAL_BYTES: '10',
    });
    const fromSpy = vi.spyOn(Buffer, 'from');
    const handlers = new NativeEmulatorHandlers();
    try {
      const f1 = Buffer.from([1, 2, 3, 4]).toString('base64');
      const f2 = Buffer.from([5, 6, 7, 8]).toString('base64');
      const f3 = Buffer.from([9, 10, 11, 12]).toString('base64'); // 12 bytes total > 10
      const res = payload(
        await handlers.handleCreateSession({ files: { '/a': f1, '/b': f2, '/c': f3 } }),
      );
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('exceeds');
      // f3 would push the total over the cap; it must be rejected before decode.
      expect(fromSpy).not.toHaveBeenCalledWith(f3, 'base64');
    } finally {
      handlers.dispose();
      fromSpy.mockRestore();
    }
  });

  it('accepts create_session VFS files under both caps', async () => {
    const { NativeEmulatorHandlers } = await loadHandlers({
      NEMU_VFS_MAX_FILE_BYTES: '10',
      NEMU_VFS_MAX_TOTAL_BYTES: '20',
    });
    const handlers = new NativeEmulatorHandlers();
    try {
      const f1 = Buffer.alloc(4).toString('base64');
      const f2 = Buffer.alloc(4).toString('base64');
      const res = payload(await handlers.handleCreateSession({ files: { '/a': f1, '/b': f2 } }));
      expect(res.success).toBe(true);
      expect(res.filesLoaded).toBe(2);
    } finally {
      handlers.dispose();
    }
  });
});
