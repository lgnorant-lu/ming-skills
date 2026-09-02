import { describe, expect, it } from 'vitest';

import { webgpuTools } from '@server/domains/webgpu/definitions';

/**
 * Schema-level resource bounds — unbounded captureCount/iterations/timeoutMs
 * parameters would let a single tool call request unbounded GPU work, polling
 * loops, or response serialization.
 */
describe('webgpu tool definition bounds', () => {
  function schemaOf(name: string) {
    const tool = webgpuTools.find((t) => t.name === name);
    expect(tool, `Missing tool definition: ${name}`).toBeDefined();
    return tool!.inputSchema.properties as Record<string, { maximum?: number; minimum?: number }>;
  }

  it('bounds every captureCount parameter', () => {
    for (const name of [
      'webgpu_capture_commands',
      'webgpu_shader_source_capture',
      'webgpu_error_capture',
      'webgpu_pipeline_dump',
    ]) {
      const captureCount = schemaOf(name).captureCount;
      expect(captureCount?.minimum).toBe(1);
      expect(captureCount?.maximum, `${name}.captureCount needs a maximum`).toBeGreaterThan(0);
    }
  });

  it('bounds timing analysis iterations', () => {
    const iterations = schemaOf('webgpu_timing_analysis').iterations;
    expect(iterations?.minimum).toBe(1);
    expect(iterations?.maximum).toBeGreaterThan(0);
  });

  it('bounds every timeoutMs parameter', () => {
    for (const name of [
      'webgpu_shader_source_capture',
      'webgpu_error_capture',
      'webgpu_pipeline_dump',
    ]) {
      const timeoutMs = schemaOf(name).timeoutMs;
      expect(timeoutMs?.minimum).toBe(100);
      expect(timeoutMs?.maximum, `${name}.timeoutMs needs a maximum`).toBeGreaterThan(0);
    }
  });
});
