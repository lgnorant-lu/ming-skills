/**
 * Regression test: `returnArray` silently swallowed a JSON.parse failure and
 * produced an empty-array mock — a malformed `returnArray` looked like a
 * valid "no elements" mock with no diagnostic at all. A VALIDATION ToolError
 * must be raised instead.
 */

import { describe, expect, it } from 'vitest';
import { buildJavaMockImpl } from '@server/domains/native-emulator/handler-java';
import { ToolError } from '@errors/ToolError';

describe('buildJavaMockImpl — returnArray validation', () => {
  it('builds an objarray mock from a valid JSON array', () => {
    const impl = buildJavaMockImpl({ returnArray: '[1, 2, 3]' });
    expect(impl.kind).toBe('array');
    expect(typeof impl.fn).toBe('function');
  });

  it('accepts a JSON array of numbers', () => {
    const impl = buildJavaMockImpl({ returnArray: '[]' });
    expect(impl.kind).toBe('array');
  });

  it('throws a VALIDATION ToolError for malformed JSON instead of an empty mock', () => {
    try {
      buildJavaMockImpl({ returnArray: '[1, 2' });
      expect.unreachable('malformed returnArray must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      expect((error as ToolError).code).toBe('VALIDATION');
      expect((error as ToolError).message).toMatch(/returnArray/);
    }
  });

  it('throws a VALIDATION ToolError for non-array JSON', () => {
    try {
      buildJavaMockImpl({ returnArray: '{"not":"an array"}' });
      expect.unreachable('non-array JSON must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      expect((error as ToolError).code).toBe('VALIDATION');
    }
  });
});
