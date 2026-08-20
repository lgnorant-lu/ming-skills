import { describe, expect, it } from 'vitest';
import { DOMAIN_TOOL_COUNT_MAP } from '@server/registry/generated-domains';
import { loadSearchCatalog } from '@server/registry/SearchCatalog';

describe('registry/SearchCatalog', () => {
  it('loads the generated full catalog with stable domain metadata', async () => {
    const catalog = await loadSearchCatalog();

    const expectedCount = Object.values(DOMAIN_TOOL_COUNT_MAP).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(catalog.tools.length).toBe(expectedCount);
    expect(catalog.domainByToolName.get('browser_launch')).toBe('browser');
    expect(catalog.domainByToolName.get('wasm_optimize')).toBe('wasm');
    expect(catalog.toolByName.get('browser_launch')?.inputSchema).toMatchObject({ type: 'object' });
  });
});
