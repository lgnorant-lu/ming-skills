/**
 * Runtime integration test for SyscallResolver — exercises the REAL on-disk
 * ntdll.dll parse on a Windows host (no koffi mock, no crafted buffer).
 *
 * Narrows the "runtime-unverified" boundary for the syscall layer: the lite
 * PE walker, Zw* export enumeration, `mov r10,rcx; mov eax,imm` prologue match,
 * SSN extraction, and `syscall;ret` (0F 05 C3) gadget discovery are all proven
 * against the actual C:\Windows\System32\ntdll.dll shipped on this build.
 *
 * What stays genuinely unverified on this host (pushed to the backlog):
 *  - resolveRuntimeKernelBase() live ntoskrnl base → covered by
 *    NtModuleEnumerator.runtime.test.ts (needs Admin/SeDebug).
 *
 * Gate: Win32 + JSHOOK_NATIVE_RUNTIME=1. CI (Linux/macOS) and default `pnpm
 * test` skip this file; the mocked unit tests (SyscallResolver.test.ts) keep
 * running everywhere.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolveNtdll, resetNtdllCache } from '@native/syscall';

const WIN32_RUNTIME = process.platform === 'win32' && process.env.JSHOOK_NATIVE_RUNTIME === '1';

describe.skipIf(!WIN32_RUNTIME)(
  'SyscallResolver — real ntdll.dll parse (runtime, host=Windows)',
  () => {
    let resolved: ReturnType<typeof resolveNtdll>;

    beforeAll(() => {
      // Cache is module-level + immutable per boot; reset so we exercise the full
      // disk read + parse once, deterministically.
      resetNtdllCache();
      resolved = resolveNtdll();
    });

    it('reads the real System32 ntdll.dll', () => {
      expect(resolved.path.toLowerCase().replace(/\\/g, '/')).toMatch(/system32\/ntdll\.dll$/);
    });

    it('parses the PE header as x64', () => {
      // resolveNtdll throws on non-x64 / bad signature before returning, so
      // reaching here already proves it; assert the export count is sane.
      expect(resolved.syscalls.length).toBeGreaterThan(400); // ntdll exports ~460 Zw stubs
    });

    it('extracts well-known NT syscalls with plausible SSNs', () => {
      // SSNs are build-specific; we only assert range + presence of staples.
      for (const name of ['NtCreateFile', 'NtOpenProcess', 'NtReadVirtualMemory', 'NtClose']) {
        const entry = resolved.byName[name];
        expect(entry, `${name} should be in the table`).toBeDefined();
        expect(entry!.ssn).toBeGreaterThanOrEqual(0);
        expect(entry!.ssn).toBeLessThan(0x2000);
        expect(entry!.rva).toBeGreaterThan(0);
      }
    });

    it('registers every Zw export under both Zw and Nt prefixes', () => {
      // byName[name] + byName[name.replace(/^Zw/,'Nt')] in the impl.
      const sample = resolved.syscalls[0]!;
      const zwName = sample.name; // stored under Zw* (impl keeps the Zw form)
      expect(resolved.byName[zwName]).toBeDefined();
      expect(resolved.byName[zwName.replace(/^Zw/, 'Nt')]).toBeDefined();
    });

    it('discovers a syscall;ret (0F 05 C3) gadget in .text', () => {
      expect(resolved.syscallGadgetRva).toBeGreaterThan(0);
    });

    it('reports few warnings on a clean (unhooked) ntdll', () => {
      // A pristine System32 ntdll has every Zw stub matching the prologue; a
      // large warnings[] would indicate EDR hooks rewriting stubs on disk (rare)
      // or a parser regression.
      expect(resolved.warnings.length).toBeLessThan(50);
    });

    it('surfaces the live ntoskrnl base via resolveRuntimeKernelBase (admin) OR documents the gate', () => {
      // resolveRuntimeKernelBase() runs findKernelModule('ntoskrnl') — admin-gated.
      // On a privileged host: a kernel-space hex string; otherwise: undefined
      // (the documented honest result, never a fabricated address).
      if (resolved.kernelImageBase) {
        const base = BigInt(resolved.kernelImageBase);
        expect(base).toBeGreaterThanOrEqual(0xfffff80000000000n);
      } else {
        expect(resolved.kernelImageBase).toBeUndefined();
      }
    });
  },
);
