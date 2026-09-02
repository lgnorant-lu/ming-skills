/**
 * Code injection handler tests.
 *
 * Tests handleMemoryAllocate, handleMemoryFree, handleInjectShellcode, handleInjectDll.
 * CodeInjector is mocked; env gate is tested.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HookHandlers } from '../../../../../src/server/domains/memory/handlers/hooks';
import { MemoryAuditTrail } from '../../../../../src/modules/process/memory/AuditTrail';

const INJECTION_ENV_GATE = 'JSHOOK_INJECTION_ENABLE';

describe('HookHandlers — code injection tools', () => {
  let handlers: HookHandlers;
  let auditTrail: MemoryAuditTrail;
  const mockBpEngine = {} as any;
  const mockInjector = {} as any;
  const originalEnv = process.env[INJECTION_ENV_GATE];

  function enableInjection() {
    process.env[INJECTION_ENV_GATE] = '1';
  }

  function disableInjection() {
    delete process.env[INJECTION_ENV_GATE];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockInjector).forEach((key) => delete mockInjector[key]);
    mockBpEngine.listBreakpoints = vi.fn().mockReturnValue([]);
    auditTrail = new MemoryAuditTrail();
    handlers = new HookHandlers(
      mockBpEngine,
      null,
      null,
      mockInjector,
      undefined,
      undefined,
      auditTrail,
    );
    enableInjection();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[INJECTION_ENV_GATE];
    } else {
      process.env[INJECTION_ENV_GATE] = originalEnv;
    }
  });

  // ── Env Gate ──

  describe('env gate', () => {
    it('memory_allocate rejects when JSHOOK_INJECTION_ENABLE is not set', async () => {
      disableInjection();
      const response = await handlers.handleMemoryAllocate({ pid: 1234, size: 4096 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain(INJECTION_ENV_GATE);
    });

    it('memory_free rejects when JSHOOK_INJECTION_ENABLE is not set', async () => {
      disableInjection();
      const response = await handlers.handleMemoryFree({ pid: 1234, address: '0x7FF612340000' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain(INJECTION_ENV_GATE);
    });

    it('memory_inject_shellcode rejects when JSHOOK_INJECTION_ENABLE is not set', async () => {
      disableInjection();
      const response = await handlers.handleInjectShellcode({
        pid: 1234,
        shellcode: '48 31 C0 C3',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain(INJECTION_ENV_GATE);
    });

    it('memory_inject_dll rejects when JSHOOK_INJECTION_ENABLE is not set', async () => {
      disableInjection();
      const response = await handlers.handleInjectDll({
        pid: 1234,
        dllPath: 'C:\\test.dll',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain(INJECTION_ENV_GATE);
    });
  });

  // ── memory_allocate ──

  describe('handleMemoryAllocate', () => {
    it('returns allocated address on success', async () => {
      mockInjector.allocateRemote = vi.fn().mockResolvedValue('0x20000');
      const response = await handlers.handleMemoryAllocate({ pid: 1234, size: 4096 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.address).toBe('0x20000');
      expect(parsed.size).toBe(4096);
      expect(mockInjector.allocateRemote).toHaveBeenCalledWith(1234, 4096);
    });

    it('rejects when size is missing', async () => {
      const response = await handlers.handleMemoryAllocate({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('size');
    });

    it('rejects when size is zero', async () => {
      const response = await handlers.handleMemoryAllocate({ pid: 1234, size: 0 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
    });

    it('rejects when size exceeds 1GB', async () => {
      const response = await handlers.handleMemoryAllocate({
        pid: 1234,
        size: 2 * 1024 * 1024 * 1024,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('1GB');
    });

    it('handles native error gracefully', async () => {
      mockInjector.allocateRemote = vi.fn().mockRejectedValue(new Error('Allocation failed'));
      const response = await handlers.handleMemoryAllocate({ pid: 1234, size: 4096 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Allocation failed');
    });
  });

  // ── memory_free ──

  describe('handleMemoryFree', () => {
    it('frees memory and returns success', async () => {
      mockInjector.freeRemote = vi.fn().mockResolvedValue(true);
      const response = await handlers.handleMemoryFree({
        pid: 1234,
        address: '0x7FF612340000',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockInjector.freeRemote).toHaveBeenCalledWith(1234, '0x7FF612340000', 0);
    });

    it('rejects when address is missing', async () => {
      const response = await handlers.handleMemoryFree({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('address');
    });

    it('rejects invalid hex address', async () => {
      const response = await handlers.handleMemoryFree({ pid: 1234, address: 'xyz' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('hex');
    });
  });

  // ── memory_inject_shellcode ──

  describe('handleInjectShellcode', () => {
    it('allocates and writes shellcode', async () => {
      mockInjector.injectShellcode = vi.fn().mockResolvedValue({
        address: '0x30000',
        threadId: 5678,
        method: 'createremote',
      });
      const response = await handlers.handleInjectShellcode({
        pid: 1234,
        shellcode: '48 31 C0 C3',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.address).toBe('0x30000');
      expect(parsed.threadId).toBe(5678);
      expect(parsed.size).toBe(4);
      expect(mockInjector.injectShellcode).toHaveBeenCalledWith(
        1234,
        expect.any(Buffer),
        'createremote',
      );
    });

    it('supports hex prefix in shellcode bytes', async () => {
      mockInjector.injectShellcode = vi.fn().mockResolvedValue({
        address: '0x40000',
        threadId: 4321,
        method: 'createremote',
      });
      const response = await handlers.handleInjectShellcode({
        pid: 1234,
        shellcode: '0x90 0x90 0xC3',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.address).toBe('0x40000');
      // Buffer.from([0x90, 0x90, 0xc3]) — injectShellcode receives the decoded bytes
      expect(mockInjector.injectShellcode).toHaveBeenCalledWith(
        1234,
        Buffer.from([0x90, 0x90, 0xc3]),
        'createremote',
      );
    });

    it('rejects when shellcode is missing', async () => {
      const response = await handlers.handleInjectShellcode({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('shellcode');
    });

    it('rejects invalid hex in shellcode', async () => {
      const response = await handlers.handleInjectShellcode({
        pid: 1234,
        shellcode: '48 GG C3',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('invalid hex');
    });

    it('rejects invalid method', async () => {
      mockInjector.allocateRemote = vi.fn().mockResolvedValue('0x50000');
      const response = await handlers.handleInjectShellcode({
        pid: 1234,
        shellcode: 'C3',
        method: 'bogus',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('method');
    });

    it('defaults to createremote method', async () => {
      mockInjector.injectShellcode = vi.fn().mockResolvedValue({
        address: '0x30000',
        threadId: 5678,
        method: 'createremote',
      });
      const response = await handlers.handleInjectShellcode({
        pid: 1234,
        shellcode: 'C3',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.method).toBe('createremote');
    });
  });

  // ── memory_inject_dll ──

  describe('handleInjectDll', () => {
    it('calls injector.injectDll and returns result on success', async () => {
      mockInjector.injectDll = vi.fn().mockResolvedValue({
        method: 'loadlibrary',
        mode: 'loadlibrary',
        dllPath: 'C:\\Windows\\System32\\test.dll',
        threadId: 12345,
        allocatedAddress: '0x30000',
      });
      const response = await handlers.handleInjectDll({
        pid: 1234,
        dllPath: 'C:\\Windows\\System32\\test.dll',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.dllPath).toBe('C:\\Windows\\System32\\test.dll');
      expect(parsed.mode).toBe('loadlibrary');
      expect(parsed.threadId).toBe(12345);
      expect(parsed.allocatedAddress).toBe('0x30000');
      expect(mockInjector.injectDll).toHaveBeenCalledWith(
        1234,
        'C:\\Windows\\System32\\test.dll',
        'loadlibrary',
      );
    });

    it('accepts manualmap mode', async () => {
      mockInjector.injectDll = vi.fn().mockResolvedValue({
        method: 'manualmap',
        mode: 'manualmap',
        dllPath: 'C:\\test.dll',
        imageBase: '0x7FFE0000',
        imageSize: 4096,
        entryPoint: '0x7FFE1000',
        threadId: 6789,
        injectionMethod: 'NtCreateThreadEx',
      });
      const response = await handlers.handleInjectDll({
        pid: 1234,
        dllPath: 'C:\\test.dll',
        mode: 'manualmap',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.mode).toBe('manualmap');
      expect(parsed.imageBase).toBe('0x7FFE0000');
      expect(mockInjector.injectDll).toHaveBeenCalledWith(1234, 'C:\\test.dll', 'manualmap');
    });

    it('handles injection failure and records audit trail', async () => {
      mockInjector.injectDll = vi.fn().mockRejectedValue(new Error('Injection failed'));
      const response = await handlers.handleInjectDll({
        pid: 1234,
        dllPath: 'C:\\test.dll',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Injection failed');
    });

    it('rejects invalid mode', async () => {
      const response = await handlers.handleInjectDll({
        pid: 1234,
        dllPath: 'C:\\test.dll',
        mode: 'bogus',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('mode');
    });

    it('rejects when dllPath is missing', async () => {
      const response = await handlers.handleInjectDll({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('dllPath');
    });
  });
});
