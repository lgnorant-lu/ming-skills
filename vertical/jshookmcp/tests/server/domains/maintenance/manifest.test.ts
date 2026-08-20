import { describe, expect, it, vi } from 'vitest';
import manifest from '@server/domains/maintenance/manifest';
import { CoreMaintenanceHandlers, SandboxToolHandlers } from '@server/domains/maintenance/index';

describe('maintenance manifest', () => {
  it('should have valid domain manifest structure', async () => {
    expect(manifest.domain).toBe('maintenance');
    expect(manifest.ensure).toBeInstanceOf(Function);
  });

  it('should correctly ensure singleton handlers in context', async () => {
    const ctx: any = {
      tokenBudget: {},
      unifiedCache: {},
    };
    const h1 = await manifest.ensure(ctx);
    const h2 = await manifest.ensure(ctx);
    expect(h1).toBeInstanceOf(CoreMaintenanceHandlers);
    expect(h1).toBe(h2);
  });

  it('should populate the merged sandbox handler in context', async () => {
    const ctx: any = {
      tokenBudget: {},
      unifiedCache: {},
    };
    await manifest.ensure(ctx);
    expect(ctx.sandboxHandlers).toBeInstanceOf(SandboxToolHandlers);
    // idempotent: second ensure keeps the same sandbox instance
    const first = ctx.sandboxHandlers;
    await manifest.ensure(ctx);
    expect(ctx.sandboxHandlers).toBe(first);
  });

  it('registers execute_sandbox_script under the maintenance domain', async () => {
    const sandboxReg = manifest.registrations.find(
      (r) => (r.tool as { name: string }).name === 'execute_sandbox_script',
    );
    expect(sandboxReg).toBeDefined();
    expect(sandboxReg?.domain).toBe('maintenance');
    expect(sandboxReg?.profiles).toEqual(['full']);
  });

  it('forwards cleanup_artifacts category filters through the manifest binding', async () => {
    const cleanupReg = manifest.registrations.find(
      (r) => (r.tool as { name: string }).name === 'cleanup_artifacts',
    );
    const handleCleanupArtifacts = vi.fn(async () => ({ ok: true }));

    await cleanupReg?.bind({
      coreMaintenanceHandlers: { handleCleanupArtifacts },
    })({
      retentionDays: 7,
      maxTotalBytes: 1024,
      dryRun: true,
      categories: ['traces', 'har'],
      excludeCategories: ['tmp'],
    });

    expect(handleCleanupArtifacts).toHaveBeenCalledWith({
      retentionDays: 7,
      maxTotalBytes: 1024,
      dryRun: true,
      categories: ['traces', 'har'],
      excludeCategories: ['tmp'],
    });
  });
});
