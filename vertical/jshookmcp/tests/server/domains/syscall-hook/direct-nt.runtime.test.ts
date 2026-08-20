/**
 * Runtime integration test for DirectNtApiHandlers — exercises the REAL
 * handler→resolveNtdll→on-disk ntdll path end-to-end on a Windows host.
 *
 * Before the SyscallResolver SSN-extraction fix (caught by
 * SyscallResolver.runtime.test.ts), handleSyscallResolveSsn returned an empty
 * table on a real host; the mocked direct-nt.coverage.test.ts never saw it.
 * This file locks the real path: resolve_ssn returns a populated table + live
 * kernel base, and direct_invoke returns a real SSN + stub template.
 *
 * Gate: Win32 + JSHOOK_NATIVE_RUNTIME=1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DirectNtApiHandlers } from '@server/domains/syscall-hook/handlers/direct-nt';
import { resetNtdllCache } from '@native/syscall';

const WIN32_RUNTIME = process.platform === 'win32' && process.env.JSHOOK_NATIVE_RUNTIME === '1';

describe.skipIf(!WIN32_RUNTIME)(
  'DirectNtApiHandlers — end-to-end real ntdll (runtime, host=Windows)',
  () => {
    let handlers: DirectNtApiHandlers;

    beforeAll(() => {
      resetNtdllCache();
      handlers = new DirectNtApiHandlers();
    });

    it('handleSyscallResolveSsn returns the real syscall table + live kernel base', async () => {
      const r = await handlers.handleSyscallResolveSsn({});
      expect(r.success).toBe(true);
      expect(r.platform).toBe('win32');
      expect(r.tableSize).toBeGreaterThan(400);
      expect(r.path).toBeDefined();
      expect(r.path!.toLowerCase().replace(/\\/g, '/')).toMatch(/system32\/ntdll\.dll$/);
      // SSN table populated with well-known entries (post-fix; was empty before).
      const createFile = r.lookup?.NtCreateFile;
      expect(createFile).toBeDefined();
      expect(createFile!.ssn).toBeGreaterThanOrEqual(0);
      // Live ntoskrnl base surfaces (admin-gated; undefined is the honest fallback).
      if (r.kernelImageBase) {
        expect(BigInt(r.kernelImageBase)).toBeGreaterThanOrEqual(0xfffff00000000000n);
      }
    });

    it('handleSyscallDirectInvoke returns a real SSN + stub for NtCreateFile', async () => {
      const r = await handlers.handleSyscallDirectInvoke({ functionName: 'NtCreateFile' });
      expect(r.success).toBe(true);
      expect(r.functionName).toBe('NtCreateFile');
      expect(r.ssn).toBeGreaterThanOrEqual(0);
      expect(r.ssn).toBeLessThan(0x2000);
      // Usage guidance carries the stub hex + gadget RVA.
      expect(r.usage).toMatch(/4C 8B D1/); // mov r10, rcx
      expect(r.usage).toMatch(/Gadget RVA/);
      expect(r.note).toMatch(/bypasses user-mode hooks/);
    });

    it('handleSyscallDirectInvoke accepts the Zw prefix on a real table', async () => {
      const r = await handlers.handleSyscallDirectInvoke({ functionName: 'ZwOpenProcess' });
      expect(r.success).toBe(true);
      expect(r.ssn).toBeGreaterThanOrEqual(0);
    });
  },
);
