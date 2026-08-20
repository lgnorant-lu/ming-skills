import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransformToolHandlers } from '@server/domains/transform/handlers';

describe('TransformToolHandlers', () => {
  const collector = {
    getActivePage: vi.fn(),
  } as any;

  let handlers: TransformToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TransformToolHandlers(collector);
  });

  it('returns error when ast_transform_preview has no code', async () => {
    const body = parseJson<any>(
      await handlers.handleAstTransformPreview({ transforms: ['constant_fold'] }),
    );
    expect(body.tool).toBe('ast_transform_preview');
    expect(body.error).toContain('code must be a non-empty string');
  });

  it('applies transform preview and returns diff', async () => {
    const body = parseJson<any>(
      await handlers.handleAstTransformPreview({
        code: 'const x = 1 + 2;',
        transforms: ['constant_fold'],
        preview: true,
      }),
    );
    expect(body.appliedTransforms).toContain('constant_fold');
    expect(typeof body.diff).toBe('string');
    expect(body.transformed).toContain('3');
  });

  it('keeps wrapper preview responses un-nested', async () => {
    const body = parseJson<any>(
      await handlers.handleAstTransformPreviewTool({
        code: 'const x = 1 + 2;',
        transforms: ['constant_fold'],
        preview: true,
      }),
    );
    expect(body.appliedTransforms).toContain('constant_fold');
    expect(body.content).toBeUndefined();
  });

  it('keeps wrapper validation responses un-nested', async () => {
    const body = parseJson<any>(
      await handlers.handleAstTransformPreviewTool({ transforms: ['constant_fold'] }),
    );
    expect(body.tool).toBe('ast_transform_preview');
    expect(body.error).toContain('code must be a non-empty string');
    expect(body.content).toBeUndefined();
  });

  it('creates a named transform chain', async () => {
    const body = parseJson<any>(
      await handlers.handleAstTransformChain({
        name: 'fast',
        description: 'opt chain',
        transforms: ['constant_fold', 'dead_code_remove'],
      }),
    );
    expect(body.created).toBe(true);
    expect(body.name).toBe('fast');
    expect(body.description).toBe('opt chain');
    expect(body.transforms).toEqual(['constant_fold', 'dead_code_remove']);
  });

  it('applies transform chain by chainName', async () => {
    await handlers.handleAstTransformChain({
      name: 'fast',
      transforms: ['constant_fold'],
    });

    const body = parseJson<any>(
      await handlers.handleAstTransformApply({
        chainName: 'fast',
        code: 'const y = 2 + 3;',
      }),
    );
    expect(body.stats.transformsApplied).toContain('constant_fold');
    expect(body.transformed).toContain('5');
  });

  it('returns error when ast_transform_apply has no code or scriptId', async () => {
    const body = parseJson<any>(await handlers.handleAstTransformApply({}));
    expect(body.tool).toBe('ast_transform_apply');
    expect(body.error).toContain('Either code or scriptId');
  });

  it('returns error for unknown chainName', async () => {
    const body = parseJson<any>(
      await handlers.handleAstTransformApply({
        chainName: 'missing',
        code: 'const z = 1;',
      }),
    );
    expect(body.error).toContain('not found');
  });

  it('runs transform workbench steps with metrics and artifact hints', async () => {
    const encoded = Buffer.from('hello').toString('base64');
    const body = parseJson<any>(
      await handlers.handleTransformWorkbench({
        inputBase64: Buffer.from(encoded, 'utf8').toString('base64'),
        steps: [{ op: 'base64_decode' }, { op: 'xor', keyHex: '00' }, { op: 'entropy' }],
      }),
    );

    expect(body.success).toBe(true);
    expect(body.steps.map((step: { op: string }) => step.op)).toEqual([
      'base64_decode',
      'xor',
      'entropy',
    ]);
    expect(body.output.asciiPreview).toBe('hello');
    expect(body.output.printableRatio).toBe(1);
    expect(body.output.magicHints).toContain('text');
  });

  it('can omit full transform workbench base64 output for preview-only analysis', async () => {
    const input = Buffer.from('large-ish-output').toString('base64');
    const body = parseJson<any>(
      await handlers.handleTransformWorkbench({
        inputBase64: input,
        steps: [{ op: 'entropy' }],
        includeOutputBase64: false,
      }),
    );

    expect(body.success).toBe(true);
    expect(body.output.base64).toBeUndefined();
    expect(body.output.base64Omitted).toBe(true);
    expect(body.output.asciiPreview).toBe('large-ish-output');
  });
});
