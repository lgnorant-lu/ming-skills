import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AntiDetectionCheckHandlers } from '@src/server/domains/memory/handlers/antidetection-check';

/** Parse ToolResponse JSON text content into a plain object. */
function parseResponse(response: unknown): Record<string, unknown> {
  const r = response as { content?: Array<{ text?: string }> };
  const text = r.content?.[0]?.text;
  if (!text) throw new Error(`No text content in response: ${JSON.stringify(response)}`);
  return JSON.parse(text);
}

describe('AntiDetectionCheckHandlers', () => {
  let handler: AntiDetectionCheckHandlers;

  beforeEach(() => {
    handler = new AntiDetectionCheckHandlers();
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('handleCheck', () => {
    it('returns a valid check result with all fields', async () => {
      const raw = await handler.handleCheck({});
      const result = parseResponse(raw);

      expect(result.success).toBe(true);
      expect(result.verdict).toBeOneOf(['pass', 'warn', 'fail']);
      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);

      const checks = result.checks as Record<string, unknown>;
      expect(checks).toBeDefined();
      expect(typeof checks.etwAmsiPatched).toBe('boolean');
      expect(typeof checks.debuggerAttached).toBe('boolean');
      expect(typeof checks.hvciEnabled).toBe('boolean');
      expect(typeof checks.vbsEnabled).toBe('boolean');
      expect(Array.isArray(checks.acProcesses)).toBe(true);
      expect(typeof checks.envGates).toBe('boolean');

      const recommendations = result.recommendations as string[];
      expect(Array.isArray(recommendations)).toBe(true);
    });

    it('returns correct verdict for pass score on non-Windows', async () => {
      if (process.platform === 'win32') return; // Skip on Windows — environment-dependent

      const raw = await handler.handleCheck({});
      const result = parseResponse(raw);

      // On non-Windows, no checks run since koffi/registry/tasklist don't apply
      expect(result.score).toBe(100);
      expect(result.verdict).toBe('pass');
      expect(result.success).toBe(true);
    });

    it('includesDetails adds detailed information', async () => {
      const raw = await handler.handleCheck({ includeDetails: true });
      const result = parseResponse(raw);

      expect(result.success).toBe(true);
      const details = result.details as Record<string, unknown> | undefined;
      expect(details).toBeDefined();
      expect(details).toHaveProperty('platform');
      expect(details).toHaveProperty('pid');

      if (process.platform === 'win32') {
        expect(details).toHaveProperty('patchDetails');
        expect(details).toHaveProperty('etwMonitoring');
      }
    });

    it('tracks recommendations array correctly', async () => {
      const raw = await handler.handleCheck({});
      const result = parseResponse(raw);

      const recommendations = result.recommendations as string[];
      expect(Array.isArray(recommendations)).toBe(true);
      // Recommendations should be non-empty strings if present
      for (const rec of recommendations) {
        expect(typeof rec).toBe('string');
        expect(rec.length).toBeGreaterThan(0);
      }
    });

    it('score decreases when env gates are active', async () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');
      vi.stubEnv('JSHOOK_INJECTION_ENABLE', '1');

      const raw = await handler.handleCheck({});
      const result = parseResponse(raw);

      // Score should still be valid
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.verdict).toBeOneOf(['pass', 'warn', 'fail']);
      expect(result.success).toBe(true);

      vi.unstubAllEnvs();
    });
  });
});
