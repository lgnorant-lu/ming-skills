import { describe, it, expect, vi, beforeEach } from 'vitest';

import { manifestTestMocksInstalled } from '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

void manifestTestMocksInstalled;

describe('server/domains/workflow exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes workflow tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'workflow',
      definitionExportNames: ['workflowToolDefinitions', 'macroTools'],
      loadDefinitions: () =>
        import('@server/domains/workflow/definitions').then(async (m) => {
          const macro = await import('@server/domains/workflow/macro/definitions');
          return { ...m, macroTools: macro.macroTools };
        }),
      getToolArrays: (module) => [
        module.workflowToolDefinitions as Array<Record<string, unknown>>,
        module.macroTools as Array<Record<string, unknown>>,
      ],
      loadManifest: () => import('@server/domains/workflow/manifest'),
    });
  });
});
