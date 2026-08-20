import { describe, expect, it } from 'vitest';

import { memoryScanToolDefinitions } from '@server/domains/memory/definitions';

function toolByName(name: string) {
  const tool = memoryScanToolDefinitions.find((candidate) => candidate.name === name);
  expect(tool, `Missing tool definition: ${name}`).toBeDefined();
  return tool!;
}

describe('memory tool schema coverage', () => {
  it('keeps pid optional for memory tools that support runtime auto-discovery', async () => {
    for (const name of [
      'memory_first_scan',
      'memory_unknown_scan',
      'memory_pointer_scan',
      'memory_group_scan',
      'memory_structure_analyze',
    ]) {
      const tool = toolByName(name);
      expect(tool.inputSchema.properties).toHaveProperty('pid');
      expect(tool.inputSchema.required ?? []).not.toContain('pid');
    }
  });

  it('declares sessionId for follow-up scan operations', async () => {
    const tool = toolByName('memory_next_scan');
    expect(tool.inputSchema.properties).toHaveProperty('sessionId');
    expect(tool.inputSchema.required).toContain('sessionId');
  });
});
