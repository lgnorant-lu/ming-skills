import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockCopyFile = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
const mockRm = vi.hoisted(() => vi.fn());
const mockPathExists = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  copyFile: mockCopyFile,
  rename: mockRename,
  rm: mockRm,
}));

vi.mock('@server/domains/platform/handlers/platform-utils', () => ({
  parseStringArg: (args: Record<string, unknown>, key: string) => {
    const value = args[key];
    return typeof value === 'string' ? value : undefined;
  },
  pathExists: mockPathExists,
}));

function buildMockElectronExe(): Buffer {
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZIA', 'ascii');
  const prefix = Buffer.alloc(256, 0x90); // NOP sled padding
  return Buffer.concat([
    prefix,
    sentinel,
    Buffer.from([0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]),
  ]);
}

type JsonPayload = Record<string, unknown>;

function parse(result: { content: Array<{ text?: string; type?: string }> }): JsonPayload {
  return JSON.parse(result.content[0]!.text!) as JsonPayload;
}

describe('electron_patch_fuses atomic write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(buildMockElectronExe());
    mockCopyFile.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the patched buffer to a temp sibling then renames over the exe', async () => {
    const { handleElectronPatchFuses } =
      await import('@server/domains/platform/handlers/electron-fuse-handler');
    const result = parse(
      await handleElectronPatchFuses({ exePath: 'C:\\Electron\\app.exe', profile: 'debug' }),
    );
    expect(result.success).toBe(true);

    expect(mockWriteFile).toHaveBeenCalledWith('C:\\Electron\\app.exe.tmp', expect.any(Buffer));
    expect(mockRename).toHaveBeenCalledWith('C:\\Electron\\app.exe.tmp', 'C:\\Electron\\app.exe');
    // The original is never overwritten in place
    expect(mockWriteFile).not.toHaveBeenCalledWith('C:\\Electron\\app.exe', expect.anything());
  });

  it('creates the backup before the atomic replace', async () => {
    const { handleElectronPatchFuses } =
      await import('@server/domains/platform/handlers/electron-fuse-handler');
    await handleElectronPatchFuses({ exePath: 'C:\\Electron\\app.exe', profile: 'debug' });

    expect(mockCopyFile).toHaveBeenCalledWith('C:\\Electron\\app.exe', 'C:\\Electron\\app.exe.bak');
    const copyOrder = mockCopyFile.mock.invocationCallOrder[0]!;
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0]!;
    const renameOrder = mockRename.mock.invocationCallOrder[0]!;
    expect(copyOrder).toBeLessThan(writeOrder);
    expect(writeOrder).toBeLessThan(renameOrder);
  });

  it('skips the backup when createBackup=false', async () => {
    const { handleElectronPatchFuses } =
      await import('@server/domains/platform/handlers/electron-fuse-handler');
    const result = parse(
      await handleElectronPatchFuses({
        exePath: 'C:\\Electron\\app.exe',
        profile: 'debug',
        createBackup: false,
      }),
    );
    expect(result.success).toBe(true);
    expect(mockCopyFile).not.toHaveBeenCalled();
  });

  it('cleans up the temp sibling and surfaces a rename failure as an error', async () => {
    mockRename.mockRejectedValueOnce(new Error('EBUSY: target is locked'));
    const { handleElectronPatchFuses } =
      await import('@server/domains/platform/handlers/electron-fuse-handler');
    const result = parse(
      await handleElectronPatchFuses({ exePath: 'C:\\Electron\\app.exe', profile: 'debug' }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('EBUSY');
    expect(mockRm).toHaveBeenCalledWith('C:\\Electron\\app.exe.tmp', { force: true });
  });
});
