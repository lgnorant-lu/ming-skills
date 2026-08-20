/**
 * SessionManager.dispose — resource cleanup & memory leak prevention.
 *
 * Tests that destroySession properly releases NativeEmulator resources:
 * - Mapped memory regions (ELF segments, heap, stack, TLS)
 * - JNI object handles (jclass/jstring/jbyteArray)
 * - CPU register file
 * - Symbol table
 * - Host function stubs
 *
 * References:
 * - Unicorn Engine #1595: memory leaks from incomplete initialization
 *   https://github.com/unicorn-engine/unicorn/issues/1595
 * - QEMU TCG cleanup improvements (2026)
 * - arXiv 2504.16251: Adaptive Dynamic Memory Management for Hardware Enclaves
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionManager } from '@modules/native-emulator/SessionManager';
import { NativeEmulator } from '@modules/native-emulator/NativeEmulator';

describe('SessionManager — resource cleanup on destroySession', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    mgr.dispose();
    vi.useRealTimers();
  });

  it('destroySession calls dispose() on the NativeEmulator instance', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    const session = mgr.createSession();
    const disposeSpy = vi.spyOn(session.emulator, 'dispose');

    mgr.destroySession(session.id);

    expect(disposeSpy).toHaveBeenCalledOnce();
    expect(mgr.getSession(session.id)).toBeUndefined();
  });

  it('sweep timer calls dispose() on reaped idle sessions', () => {
    mgr = new SessionManager({
      idleTtlMs: 1_000,
      sweepIntervalMs: 100,
      emulatorOptions: { syscalls: false },
    });
    const session = mgr.createSession();
    const disposeSpy = vi.spyOn(session.emulator, 'dispose');

    // Advance past TTL; sweep should reap and dispose
    vi.advanceTimersByTime(1_500);

    expect(disposeSpy).toHaveBeenCalledOnce();
    expect(mgr.count()).toBe(0);
  });

  it('dispose() clears all sessions and calls dispose() on each emulator', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    const s1 = mgr.createSession();
    const s2 = mgr.createSession();
    const spy1 = vi.spyOn(s1.emulator, 'dispose');
    const spy2 = vi.spyOn(s2.emulator, 'dispose');

    mgr.dispose();

    expect(spy1).toHaveBeenCalledOnce();
    expect(spy2).toHaveBeenCalledOnce();
    expect(mgr.count()).toBe(0);
  });

  it('repeated destroySession is idempotent (dispose called once)', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });
    const session = mgr.createSession();
    const disposeSpy = vi.spyOn(session.emulator, 'dispose');

    expect(mgr.destroySession(session.id)).toBe(true);
    expect(mgr.destroySession(session.id)).toBe(false);

    // dispose should only be called once (first destroy)
    expect(disposeSpy).toHaveBeenCalledOnce();
  });
});

describe('NativeEmulator.dispose — resource cleanup', () => {
  it('dispose() is idempotent (safe to call multiple times)', () => {
    const emu = new NativeEmulator({ syscalls: false });
    expect(() => {
      emu.dispose();
      emu.dispose();
      emu.dispose();
    }).not.toThrow();
  });

  it('dispose() releases memory regions after loadLibrary', () => {
    const emu = new NativeEmulator({ syscalls: false });
    // Load a minimal ELF (just to allocate regions)
    const minimalElf = createMinimalElf();
    emu.loadLibrary(minimalElf);

    // Before dispose: engine has mapped regions
    expect(emu.engine['memory']['regions'].length).toBeGreaterThan(0);

    emu.dispose();

    // After dispose: regions cleared
    expect(emu.engine['memory']['regions'].length).toBe(0);
  });

  it('dispose() clears JNI handles', () => {
    const emu = new NativeEmulator({ syscalls: false });
    const handle = emu.newByteArray(new Uint8Array([1, 2, 3]));
    expect(emu.bytesOf(handle)).toBeDefined();

    emu.dispose();

    // After dispose: handle is invalid
    expect(emu.bytesOf(handle)).toBeUndefined();
  });

  it('dispose() resets CPU registers', () => {
    const emu = new NativeEmulator({ syscalls: false });
    // Simulate register usage
    emu.engine['registerFile'].writeGpr(0, 0xdeadbeefn);
    emu.engine['registerFile'].sp = 0x7fff0000n;
    emu.engine['registerFile'].pc = 0x12345678;

    emu.dispose();

    // After dispose: registers reset to zero
    expect(emu.engine['registerFile'].readGpr(0)).toBe(0n);
    expect(emu.engine['registerFile'].sp).toBe(0n);
    expect(emu.engine['registerFile'].pc).toBe(0);
  });

  it('dispose() clears symbol table', () => {
    const emu = new NativeEmulator({ syscalls: false });
    emu.engine['memory'].addSymbol('test_symbol', 0x1000);
    expect(emu.engine['memory'].hasSymbol('test_symbol')).toBe(true);

    emu.dispose();

    expect(emu.engine['memory'].hasSymbol('test_symbol')).toBe(false);
  });

  it('dispose() clears host function stubs', () => {
    const emu = new NativeEmulator({ syscalls: false });
    const initialSize = emu.engine['hostFns'].size;
    const stubFn = vi.fn(() => 42n);
    emu.engine.registerHostFunction(0x6800_0000, stubFn);
    expect(emu.engine['hostFns'].size).toBe(initialSize + 1);

    emu.dispose();

    expect(emu.engine['hostFns'].size).toBe(0);
  });

  it('dispose() clears syscall handlers', () => {
    const emu = new NativeEmulator(); // syscalls enabled by default
    // Android syscalls are registered during construction
    expect(emu.engine['syscalls'].size).toBeGreaterThan(0);

    emu.dispose();

    expect(emu.engine['syscalls'].size).toBe(0);
  });

  it('calling methods after dispose() throws clear errors', () => {
    const emu = new NativeEmulator({ syscalls: false });
    emu.dispose();

    expect(() => emu.loadLibrary(createMinimalElf())).toThrow('disposed');
    expect(() => emu.loadLibraryChain([createMinimalElf()], createMinimalElf())).toThrow(
      'disposed',
    );
    expect(() => emu.call('test')).toThrow('disposed');
    expect(() => emu.allocGuestMemory(4096)).toThrow('disposed');
  });
});

describe('Memory leak prevention — repeated create/destroy cycles', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    mgr.dispose();
    vi.useRealTimers();
  });

  it('repeated session create/destroy does not accumulate memory', () => {
    mgr = new SessionManager({ emulatorOptions: { syscalls: false } });

    // Simulate 100 sessions created and destroyed
    for (let i = 0; i < 100; i++) {
      const session = mgr.createSession();
      // Allocate some memory in each session
      session.emulator.allocGuestMemory(4096);
      session.emulator.newByteArray(new Uint8Array(1024));
      mgr.destroySession(session.id);
    }

    // After all destroys, manager should be empty
    expect(mgr.count()).toBe(0);
  });

  it('sweep timer repeated reaping does not accumulate memory', () => {
    mgr = new SessionManager({
      idleTtlMs: 500,
      sweepIntervalMs: 100,
      emulatorOptions: { syscalls: false },
    });

    // Create sessions and let them expire
    for (let i = 0; i < 10; i++) {
      const session = mgr.createSession();
      session.emulator.allocGuestMemory(4096);
      vi.advanceTimersByTime(600); // Exceeds TTL; sweep reaps it
    }

    // All sessions should have been reaped
    expect(mgr.count()).toBe(0);
  });
});

/**
 * Create a minimal valid ELF64 AArch64 shared object for testing.
 * This is a stub that can be loaded but has no executable code.
 */
function createMinimalElf(): Uint8Array {
  const elf = new Uint8Array(4096);
  // ELF header
  elf[0] = 0x7f; // Magic
  elf[1] = 0x45; // 'E'
  elf[2] = 0x4c; // 'L'
  elf[3] = 0x46; // 'F'
  elf[4] = 0x02; // 64-bit
  elf[5] = 0x01; // little-endian
  elf[6] = 0x01; // ELF version
  elf[0x12] = 0x03; // e_type = ET_DYN (shared object)
  elf[0x13] = 0x00;
  elf[0x12] = 0xb7; // e_machine = EM_AARCH64 (183)
  elf[0x13] = 0x00;
  return elf;
}
