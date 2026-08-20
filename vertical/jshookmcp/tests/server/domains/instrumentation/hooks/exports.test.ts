import { describe, it, expect, vi, beforeEach } from 'vitest';

import { manifestTestMocksInstalled } from '../../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../../shared/export-contract-helpers';

void manifestTestMocksInstalled;

describe('server/domains/instrumentation/hooks exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes hook tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'instrumentation',
      definitionExportNames: [
        'instrumentationTools',
        'aiHookTools',
        'hookPresetTools',
        'evidenceTools',
      ],
      loadDefinitions: () => import('@server/domains/instrumentation/definitions'),
      getToolArrays: (module) => [
        module.instrumentationTools as Array<Record<string, unknown>>,
        module.aiHookTools as Array<Record<string, unknown>>,
        module.hookPresetTools as Array<Record<string, unknown>>,
        module.evidenceTools as Array<Record<string, unknown>>,
      ],
      loadManifest: () => import('@server/domains/instrumentation/manifest'),
    });
  });
});
