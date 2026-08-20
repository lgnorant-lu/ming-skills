import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MacroConfigLoader } from '@server/macros/MacroConfigLoader';

describe('MacroConfigLoader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'macro-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loadFromDirectory() loads valid JSON files', async () => {
    const macro = {
      id: 'test_macro',
      displayName: 'Test',
      description: 'Test macro',
      steps: [{ id: 's1', toolName: 'tool_a' }],
    };
    await writeFile(join(tempDir, 'test.json'), JSON.stringify(macro));

    const result = await MacroConfigLoader.loadFromDirectory(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('test_macro');
    expect(result[0]!.displayName).toBe('Test');
    expect(result[0]!.steps).toHaveLength(1);
  });

  it('loadFromDirectory() loads multiple files', async () => {
    await writeFile(
      join(tempDir, 'a.json'),
      JSON.stringify({ id: 'macro_a', displayName: 'A', steps: [{ id: 's1', toolName: 'ta' }] }),
    );
    await writeFile(
      join(tempDir, 'b.json'),
      JSON.stringify({ id: 'macro_b', displayName: 'B', steps: [{ id: 's1', toolName: 'tb' }] }),
    );

    const result = await MacroConfigLoader.loadFromDirectory(tempDir);
    expect(result).toHaveLength(2);
    const ids = result.map((m) => m.id).toSorted();
    expect(ids).toEqual(['macro_a', 'macro_b']);
  });

  it('loadFromDirectory() skips invalid JSON (parse error)', async () => {
    await writeFile(join(tempDir, 'bad.json'), 'not valid json {{{');
    const result = await MacroConfigLoader.loadFromDirectory(tempDir);
    expect(result).toHaveLength(0);
  });

  it('loadFromDirectory() skips JSON missing required fields', async () => {
    await writeFile(
      join(tempDir, 'missing.json'),
      JSON.stringify({ id: 'x', steps: [] }), // missing displayName, empty steps
    );
    const result = await MacroConfigLoader.loadFromDirectory(tempDir);
    expect(result).toHaveLength(0);
  });

  it('loadFromDirectory() returns empty array for non-existent directory', async () => {
    const result = await MacroConfigLoader.loadFromDirectory('/tmp/nonexistent-dir-xyz-999');
    expect(result).toEqual([]);
  });

  it('loadFromDirectory() ignores non-JSON files', async () => {
    await writeFile(join(tempDir, 'readme.md'), '# hello');
    await writeFile(
      join(tempDir, 'valid.json'),
      JSON.stringify({ id: 'v', displayName: 'V', steps: [{ id: 's', toolName: 't' }] }),
    );
    const result = await MacroConfigLoader.loadFromDirectory(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('v');
  });

  it('validate() returns true for valid schema', () => {
    expect(
      MacroConfigLoader.validate({
        id: 'test',
        displayName: 'Test',
        steps: [{ id: 's1', toolName: 'tool' }],
      }),
    ).toBe(true);
  });

  it('validate() returns false for missing id', () => {
    expect(
      MacroConfigLoader.validate({
        displayName: 'Test',
        steps: [{ id: 's1', toolName: 'tool' }],
      }),
    ).toBe(false);
  });

  it('validate() returns false for empty steps array', () => {
    expect(
      MacroConfigLoader.validate({
        id: 'test',
        displayName: 'Test',
        steps: [],
      }),
    ).toBe(false);
  });

  it('validate() returns false for step missing toolName', () => {
    expect(
      MacroConfigLoader.validate({
        id: 'test',
        displayName: 'Test',
        steps: [{ id: 's1' }],
      }),
    ).toBe(false);
  });

  it('loadFromDirectory() preserves optional fields', async () => {
    const macro = {
      id: 'full',
      displayName: 'Full',
      description: 'desc',
      tags: ['a', 'b'],
      timeoutMs: 5000,
      steps: [
        {
          id: 's1',
          toolName: 'tool',
          input: { key: 'val' },
          inputFrom: { code: 'prev.code' },
          timeoutMs: 1000,
          optional: true,
        },
      ],
    };
    await writeFile(join(tempDir, 'full.json'), JSON.stringify(macro));

    const result = await MacroConfigLoader.loadFromDirectory(tempDir);
    expect(result[0]!.tags).toEqual(['a', 'b']);
    expect(result[0]!.timeoutMs).toBe(5000);
    expect(result[0]!.steps[0]!.inputFrom).toEqual({ code: 'prev.code' });
    expect(result[0]!.steps[0]!.optional).toBe(true);
  });

  it('loadFromDirectory() preserves nested orchestration fields', async () => {
    const macro = {
      id: 'rich',
      displayName: 'Rich',
      steps: [
        {
          id: 'parallel',
          parallelSteps: [
            {
              id: 'a',
              toolName: 'tool_a',
              retry: { maxAttempts: 2, backoffMs: 10, multiplier: 2 },
            },
            { id: 'b', toolName: 'tool_b' },
          ],
          maxConcurrency: 2,
          failFast: true,
        },
        {
          id: 'branch',
          branchStep: {
            predicateId: 'always_true',
            whenTrue: { id: 'yes', toolName: 'tool_yes' },
            whenFalse: { id: 'no', toolName: 'tool_no' },
          },
        },
        {
          id: 'fallback',
          fallbackStep: {
            primary: { id: 'primary', toolName: 'tool_primary' },
            fallback: { id: 'backup', toolName: 'tool_backup' },
          },
        },
      ],
    };
    await writeFile(join(tempDir, 'rich.json'), JSON.stringify(macro));

    const result = await MacroConfigLoader.loadFromDirectory(tempDir);

    expect(result[0]!.steps[0]!.parallelSteps).toHaveLength(2);
    expect(result[0]!.steps[0]!.parallelSteps?.[0]?.retry).toEqual({
      maxAttempts: 2,
      backoffMs: 10,
      multiplier: 2,
    });
    expect(result[0]!.steps[0]!.maxConcurrency).toBe(2);
    expect(result[0]!.steps[0]!.failFast).toBe(true);
    expect(result[0]!.steps[1]!.branchStep?.whenTrue.id).toBe('yes');
    expect(result[0]!.steps[2]!.fallbackStep?.fallback.id).toBe('backup');
  });

  it('validate() rejects ambiguous or incomplete orchestration steps', () => {
    expect(
      MacroConfigLoader.validate({
        id: 'bad',
        displayName: 'Bad',
        steps: [
          {
            id: 'ambiguous',
            toolName: 'tool',
            parallelSteps: [{ id: 'child', toolName: 'other' }],
          },
        ],
      }),
    ).toBe(false);

    expect(
      MacroConfigLoader.validate({
        id: 'bad',
        displayName: 'Bad',
        steps: [{ id: 'empty-parallel', parallelSteps: [] }],
      }),
    ).toBe(false);

    expect(
      MacroConfigLoader.validate({
        id: 'bad',
        displayName: 'Bad',
        steps: [{ id: 'branch', branchStep: { whenTrue: { id: 'yes', toolName: 'tool' } } }],
      }),
    ).toBe(false);

    expect(
      MacroConfigLoader.validate({
        id: 'bad',
        displayName: 'Bad',
        steps: [
          {
            id: 'parallel',
            parallelSteps: [{ id: 'child', toolName: 'tool' }],
            maxConcurrency: 0,
          },
        ],
      }),
    ).toBe(false);

    expect(
      MacroConfigLoader.validate({
        id: 'bad',
        displayName: 'Bad',
        steps: [
          {
            id: 'retry',
            toolName: 'tool',
            retry: { maxAttempts: 0, backoffMs: -1 },
          },
        ],
      }),
    ).toBe(false);
  });
});
