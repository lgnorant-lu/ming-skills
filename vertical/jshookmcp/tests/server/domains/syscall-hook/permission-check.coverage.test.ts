/**
 * Coverage tests for checkSyscallPermission — exercises the linux / win32 /
 * darwin / default branches by controlling process.platform + the fs/child_process
 * mocks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_PLATFORM = process.platform;
const mockReadFileSync = vi.fn();
const mockExecFile = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock('@utils/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

import { checkSyscallPermission } from '@server/domains/syscall-hook/permission-check';

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
});

beforeEach(() => {
  mockReadFileSync.mockReset();
  mockExecFile.mockReset();
});

describe('checkSyscallPermission — linux', () => {
  beforeEach(() => setPlatform('linux'));

  it('allows when geteuid === 0 (root)', async () => {
    const orig = process.geteuid;
    process.geteuid = (() => 0) as never;
    try {
      const r = await checkSyscallPermission();
      expect(r.hasPermission).toBe(true);
    } finally {
      process.geteuid = orig;
    }
  });

  it('allows when ptrace_scope === 0 (non-root)', async () => {
    const orig = process.geteuid;
    process.geteuid = (() => 1000) as never;
    mockReadFileSync.mockReturnValue('0\n');
    try {
      const r = await checkSyscallPermission();
      expect(r.hasPermission).toBe(true);
    } finally {
      process.geteuid = orig;
    }
  });

  it('denies when non-root + ptrace_scope != 0', async () => {
    const orig = process.geteuid;
    process.geteuid = (() => 1000) as never;
    mockReadFileSync.mockReturnValue('3\n');
    try {
      const r = await checkSyscallPermission();
      expect(r.hasPermission).toBe(false);
      expect(r.requiredCapabilities).toEqual(expect.arrayContaining(['root', 'CAP_SYS_PTRACE']));
    } finally {
      process.geteuid = orig;
    }
  });

  it('fail-opens when /proc read throws', async () => {
    const orig = process.geteuid;
    process.geteuid = (() => 1000) as never;
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    try {
      const r = await checkSyscallPermission();
      expect(r.hasPermission).toBe(true); // fail-open
    } finally {
      process.geteuid = orig;
    }
  });

  it('logs the probe failure when fail-opening (no silent mis-authorization)', async () => {
    const orig = process.geteuid;
    process.geteuid = (() => 1000) as never;
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    try {
      await checkSyscallPermission();
    } finally {
      process.geteuid = orig;
    }
    // The logger must have recorded why the check fail-opened.
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringMatching(/permission probe failed|fail-open/i),
    );
  });
});

describe('checkSyscallPermission — win32', () => {
  beforeEach(() => setPlatform('win32'));

  it('allows when logman query succeeds (Admin)', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: '', stderr: '' }),
    );
    const r = await checkSyscallPermission();
    expect(r.hasPermission).toBe(true);
  });

  it('denies when logman query fails (non-Admin)', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => cb(new Error('access denied')));
    const r = await checkSyscallPermission();
    expect(r.hasPermission).toBe(false);
    expect(r.requiredCapabilities).toEqual(['Administrator']);
  });
});

describe('checkSyscallPermission — darwin', () => {
  beforeEach(() => setPlatform('darwin'));

  it('allows when geteuid === 0', async () => {
    const orig = process.geteuid;
    process.geteuid = (() => 0) as never;
    try {
      const r = await checkSyscallPermission();
      expect(r.hasPermission).toBe(true);
    } finally {
      process.geteuid = orig;
    }
  });

  it('denies when non-root', async () => {
    const orig = process.geteuid;
    process.geteuid = (() => 501) as never;
    try {
      const r = await checkSyscallPermission();
      expect(r.hasPermission).toBe(false);
      expect(r.requiredCapabilities).toEqual(['root']);
    } finally {
      process.geteuid = orig;
    }
  });
});

describe('checkSyscallPermission — unsupported platform', () => {
  it('allows on an unknown platform (default)', async () => {
    setPlatform('solaris');
    const r = await checkSyscallPermission();
    expect(r.hasPermission).toBe(true);
  });
});
