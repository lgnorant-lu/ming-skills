/**
 * Coverage tests for DirectNtApiHandlers — exercises both platform guards,
 * the Win32 resolve + invoke paths (mocked @native/syscall), and the name
 * validation / Zw-prefix fallback / not-found branches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveNtdll = vi.fn();

vi.mock('@native/syscall', () => ({
  resolveNtdll: (...args: unknown[]) => mockResolveNtdll(...args),
}));

import { DirectNtApiHandlers } from '@server/domains/syscall-hook/handlers/direct-nt';

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
});

beforeEach(() => {
  mockResolveNtdll.mockReset();
});

describe('DirectNtApiHandlers.handleSyscallResolveSsn', () => {
  it('rejects non-Win32 platform', async () => {
    setPlatform('linux');
    const r = await new DirectNtApiHandlers().handleSyscallResolveSsn({});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Windows-only/);
    expect(r.platform).toBe('linux');
    expect(mockResolveNtdll).not.toHaveBeenCalled();
  });

  it('returns the ntdll syscall table on Win32', async () => {
    setPlatform('win32');
    mockResolveNtdll.mockReturnValue({
      path: 'C:\\Windows\\System32\\ntdll.dll',
      syscalls: [{ name: 'NtCreateFile', ssn: 0x55 }],
      byName: { NtCreateFile: { name: 'NtCreateFile', ssn: 0x55 } },
      warnings: [],
      syscallGadgetRva: 0x1000,
    });
    const r = await new DirectNtApiHandlers().handleSyscallResolveSsn({});
    expect(r.success).toBe(true);
    expect(r.tableSize).toBe(1);
    expect(r.lookup?.NtCreateFile?.ssn).toBe(0x55);
    expect(r.warnings).toBeUndefined(); // empty warnings → omitted
  });

  it('forwards a custom ntdllPath and surfaces warnings', async () => {
    setPlatform('win32');
    mockResolveNtdll.mockReturnValue({
      path: 'x',
      syscalls: [],
      byName: {},
      warnings: ['suspicious'],
      syscallGadgetRva: 0,
    });
    const r = await new DirectNtApiHandlers().handleSyscallResolveSsn({
      ntdllPath: '/custom/ntdll.dll',
    });
    expect(r.warnings).toEqual(['suspicious']);
    expect(mockResolveNtdll).toHaveBeenCalledWith('/custom/ntdll.dll');
  });

  it('returns an error when resolveNtdll throws', async () => {
    setPlatform('win32');
    mockResolveNtdll.mockImplementation(() => {
      throw new Error('ntdll not found');
    });
    const r = await new DirectNtApiHandlers().handleSyscallResolveSsn({});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/ntdll not found/);
  });
});

describe('DirectNtApiHandlers.handleSyscallDirectInvoke', () => {
  it('rejects non-Win32 platform', async () => {
    setPlatform('darwin');
    const r = await new DirectNtApiHandlers().handleSyscallDirectInvoke({
      functionName: 'NtCreateFile',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Windows-only/);
  });

  it('rejects an invalid NT function name', async () => {
    setPlatform('win32');
    const r = await new DirectNtApiHandlers().handleSyscallDirectInvoke({
      functionName: 'CreateFile',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid NT function name/);
  });

  it('accepts Zw prefix names', async () => {
    setPlatform('win32');
    mockResolveNtdll.mockReturnValue({
      path: 'x',
      syscalls: [{ name: 'ZwReadFile', ssn: 0x10 }],
      byName: { ZwReadFile: { name: 'ZwReadFile', ssn: 0x10 } },
      warnings: [],
      syscallGadgetRva: 0x2000,
    });
    const r = await new DirectNtApiHandlers().handleSyscallDirectInvoke({
      functionName: 'ZwReadFile',
    });
    expect(r.success).toBe(true);
    expect(r.ssn).toBe(0x10);
  });

  it('falls back to the Zw variant when Nt prefix not found', async () => {
    setPlatform('win32');
    mockResolveNtdll.mockReturnValue({
      path: 'x',
      syscalls: [{ name: 'ZwCreateFile', ssn: 0x55 }],
      byName: { ZwCreateFile: { name: 'ZwCreateFile', ssn: 0x55 } },
      warnings: [],
      syscallGadgetRva: 0x1000,
    });
    const r = await new DirectNtApiHandlers().handleSyscallDirectInvoke({
      functionName: 'NtCreateFile',
    });
    expect(r.success).toBe(true);
    expect(r.ssn).toBe(0x55);
    expect(r.usage).toMatch(/NtCreateFile/);
    expect(r.note).toMatch(/bypasses user-mode hooks/);
  });

  it('returns not-found when neither Nt nor Zw variant exists', async () => {
    setPlatform('win32');
    mockResolveNtdll.mockReturnValue({
      path: 'x',
      syscalls: [{ name: 'NtReadFile', ssn: 1 }],
      byName: { NtReadFile: { name: 'NtReadFile', ssn: 1 } },
      warnings: [],
      syscallGadgetRva: 0x500,
    });
    const r = await new DirectNtApiHandlers().handleSyscallDirectInvoke({
      functionName: 'NtNoSuch',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found in ntdll export table/);
  });

  it('errors when functionName arg is missing (argStringRequired throws)', async () => {
    setPlatform('win32');
    const r = await new DirectNtApiHandlers().handleSyscallDirectInvoke({});
    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
  });
});
