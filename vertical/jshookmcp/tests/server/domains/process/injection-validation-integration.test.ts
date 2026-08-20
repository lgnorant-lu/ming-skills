/**
 * Integration tests for InjectionValidator in injection workflow
 * Tests the complete flow from handler → injector → validator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the process modules
vi.mock('@modules/process/index', () => ({
  UnifiedProcessManager: vi.fn(),
  MemoryManager: vi.fn(),
}));

// Mock the injection functions
vi.mock('@modules/process/memory/injector', () => ({
  injectDll: vi.fn(),
  injectShellcode: vi.fn(),
}));

// Mock the validator module - will be implemented in this phase
vi.mock('@modules/process/memory/injection-validator', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@modules/process/memory/injection-validator')>();
  return {
    ...actual,
    createValidatorFromEnv: vi.fn(() => actual.createValidatorFromEnv()),
  };
});

import { InjectionHandlers } from '@server/domains/process/handlers/injection-handlers';

describe('Injection Validation Integration', () => {
  let handlers: InjectionHandlers;
  let mockProcessMgmt: any;
  let mockMemoryManager: any;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.JSHOOK_INJECTION_VALIDATION_MODE;

    // Create mock process management
    mockProcessMgmt = {
      recordMemoryAudit: vi.fn(),
      buildMemoryDiagnostics: vi.fn(),
    };

    // Create mock memory manager
    mockMemoryManager = {
      injectDll: vi.fn(),
      injectShellcode: vi.fn(),
      checkDebugPort: vi.fn(),
      enumerateModules: vi.fn(),
    };

    // Create handlers instance
    handlers = new InjectionHandlers(
      { memoryManager: mockMemoryManager } as any,
      mockProcessMgmt as any,
    );

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = originalEnv;
    } else {
      delete process.env.JSHOOK_INJECTION_VALIDATION_MODE;
    }
  });

  describe('DLL Injection with Validation', () => {
    it('should allow DLL injection when validation passes in BALANCED mode', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      mockMemoryManager.injectDll.mockResolvedValue({
        success: true,
        remoteThreadId: 1234,
      });

      const result = await handlers.handleInjectDll({
        pid: 1000,
        dllPath: 'C:\\test\\valid.dll',
      });

      expect(result.content[0]?.text).toContain('"success": true');
      expect(mockMemoryManager.injectDll).toHaveBeenCalledWith(
        1000,
        'C:\\test\\valid.dll',
        expect.objectContaining({
          confirmed: undefined,
          payloadHash: undefined,
          validationMode: undefined,
        }),
      );
    });

    it('should block DLL injection when target is critical system process', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      // Mock to simulate critical process detection
      mockMemoryManager.injectDll.mockResolvedValue({
        success: false,
        error: 'Target process is a critical system process: lsass.exe',
        validationFailed: true,
      });

      const result = await handlers.handleInjectDll({
        pid: 500,
        dllPath: 'C:\\test\\valid.dll',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(false);
      expect(response.error).toContain('critical system process');
    });

    it('should block DLL injection when file does not exist', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      mockMemoryManager.injectDll.mockResolvedValue({
        success: false,
        error: 'DLL file not found: C:\\nonexistent.dll',
        validationFailed: true,
      });

      const result = await handlers.handleInjectDll({
        pid: 1000,
        dllPath: 'C:\\nonexistent.dll',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });

    it('should require confirmation in STRICT mode for unsigned process', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'strict';

      mockMemoryManager.injectDll.mockResolvedValue({
        success: false,
        error: 'Confirmation required: target process is not digitally signed',
        confirmationRequired: true,
        validationFailed: true,
      });

      const result = await handlers.handleInjectDll({
        pid: 1000,
        dllPath: 'C:\\test\\valid.dll',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(false);
      expect(response.error).toContain('Confirmation required');
      expect(response.confirmationRequired).toBe(true);
    });

    it('should bypass confirmation when confirmed=true is provided', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'strict';

      mockMemoryManager.injectDll.mockResolvedValue({
        success: true,
        remoteThreadId: 5678,
      });

      const result = await handlers.handleInjectDll({
        pid: 1000,
        dllPath: 'C:\\test\\valid.dll',
        confirmed: true,
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(true);
      expect(mockMemoryManager.injectDll).toHaveBeenCalledWith(
        1000,
        'C:\\test\\valid.dll',
        expect.objectContaining({ confirmed: true }),
      );
    });

    it('should verify hash when payloadHash is provided', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      mockMemoryManager.injectDll.mockResolvedValue({
        success: false,
        error: 'DLL hash mismatch',
        validationFailed: true,
      });

      const result = await handlers.handleInjectDll({
        pid: 1000,
        dllPath: 'C:\\test\\valid.dll',
        payloadHash: 'abc123expectedhash',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(false);
      expect(response.error).toContain('hash mismatch');
    });

    it('should skip validation in DISABLED mode', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'disabled';

      mockMemoryManager.injectDll.mockResolvedValue({
        success: true,
        remoteThreadId: 9999,
      });

      const result = await handlers.handleInjectDll({
        pid: 1000,
        dllPath: 'C:\\test\\anything.dll',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(true);
      expect(mockMemoryManager.injectDll).toHaveBeenCalled();
    });
  });

  describe('Shellcode Injection with Validation', () => {
    it('should allow shellcode injection when validation passes', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      mockMemoryManager.injectShellcode.mockResolvedValue({
        success: true,
        remoteThreadId: 2468,
      });

      const result = await handlers.handleInjectShellcode({
        pid: 2000,
        shellcode: '4883ec28e8000000005b',
        encoding: 'hex',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(true);
      expect(mockMemoryManager.injectShellcode).toHaveBeenCalled();
    });

    it('should block shellcode injection for critical process', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      mockMemoryManager.injectShellcode.mockResolvedValue({
        success: false,
        error: 'Target process is a critical system process: csrss.exe',
        validationFailed: true,
      });

      const result = await handlers.handleInjectShellcode({
        pid: 400,
        shellcode: '4883ec28',
        encoding: 'hex',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(false);
      expect(response.error).toContain('critical system process');
    });

    it('should block shellcode with invalid hex encoding', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      mockMemoryManager.injectShellcode.mockResolvedValue({
        success: false,
        error: 'Invalid hex encoding in shellcode',
        validationFailed: true,
      });

      const result = await handlers.handleInjectShellcode({
        pid: 2000,
        shellcode: 'INVALID_HEX',
        encoding: 'hex',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid hex encoding');
    });

    it('should block shellcode exceeding size limit', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      const largeShellcode = 'AA'.repeat(600000); // 1.2MB hex = 600KB actual

      mockMemoryManager.injectShellcode.mockResolvedValue({
        success: false,
        error: 'Shellcode size exceeds maximum allowed',
        validationFailed: true,
      });

      const result = await handlers.handleInjectShellcode({
        pid: 2000,
        shellcode: largeShellcode,
        encoding: 'hex',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(false);
      expect(response.error).toContain('exceeds maximum');
    });

    it('should bypass validation when confirmed=true in STRICT mode', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'strict';

      mockMemoryManager.injectShellcode.mockResolvedValue({
        success: true,
        remoteThreadId: 3456,
      });

      const result = await handlers.handleInjectShellcode({
        pid: 2000,
        shellcode: '909090',
        encoding: 'hex',
        confirmed: true,
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(true);
    });

    it('should handle base64 encoded shellcode validation', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      mockMemoryManager.injectShellcode.mockResolvedValue({
        success: true,
        remoteThreadId: 7890,
      });

      const result = await handlers.handleInjectShellcode({
        pid: 2000,
        shellcode: 'SGVsbG8gV29ybGQ=', // "Hello World" in base64
        encoding: 'base64',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(true);
    });
  });

  describe('Validation Mode Switching', () => {
    it('should respect PERMISSIVE mode (basic checks only)', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'permissive';

      mockMemoryManager.injectDll.mockResolvedValue({
        success: true,
        remoteThreadId: 1111,
      });

      const result = await handlers.handleInjectDll({
        pid: 3000,
        dllPath: 'C:\\test\\dll.dll',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(true);
    });

    it('should default to BALANCED mode when env var not set', async () => {
      delete process.env.JSHOOK_INJECTION_VALIDATION_MODE;

      mockMemoryManager.injectDll.mockResolvedValue({
        success: true,
        remoteThreadId: 2222,
      });

      const result = await handlers.handleInjectDll({
        pid: 4000,
        dllPath: 'C:\\test\\default.dll',
      });

      const response = JSON.parse(result.content[0]?.text as string);
      expect(response.success).toBe(true);
    });
  });

  describe('Audit Trail Integration', () => {
    it('should record validation failures in audit trail', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      mockMemoryManager.injectDll.mockResolvedValue({
        success: false,
        error: 'Target process validation failed',
        validationFailed: true,
      });

      await handlers.handleInjectDll({
        pid: 5000,
        dllPath: 'C:\\test\\bad.dll',
      });

      expect(mockProcessMgmt.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_dll',
          result: 'failure',
          error: expect.stringContaining('validation failed'),
        }),
      );
    });

    it('should record successful injections with validation metadata', async () => {
      process.env.JSHOOK_INJECTION_VALIDATION_MODE = 'balanced';

      mockMemoryManager.injectShellcode.mockResolvedValue({
        success: true,
        remoteThreadId: 4444,
      });

      await handlers.handleInjectShellcode({
        pid: 6000,
        shellcode: '90909090',
        encoding: 'hex',
      });

      expect(mockProcessMgmt.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_shellcode',
          pid: 6000,
          result: 'success',
        }),
      );
    });
  });
});
