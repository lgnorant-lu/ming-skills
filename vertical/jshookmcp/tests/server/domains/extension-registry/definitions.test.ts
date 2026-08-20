import { describe, expect, it } from 'vitest';
import { extensionRegistryTools } from '@server/domains/extension-registry/definitions';

describe('extension-registry domain definitions', () => {
  it('declares install and info lifecycle tools', () => {
    const names = extensionRegistryTools.map((tool) => tool.name);

    expect(names).toContain('extension_install');
    expect(names).toContain('extension_info');
    expect(names).toContain('extension_list_installed');
    expect(names).toContain('extension_execute_in_context');
  });

  it('declares install manifest/source inputs', () => {
    const installTool = extensionRegistryTools.find((tool) => tool.name === 'extension_install');

    expect(installTool?.inputSchema.properties).toHaveProperty('source');
    expect(installTool?.inputSchema.properties).toHaveProperty('manifest');
    expect(installTool?.inputSchema.properties).toHaveProperty('entry');
    expect(installTool?.inputSchema.properties).toHaveProperty('permissions');
  });

  it('requires pluginId for extension_info', () => {
    const infoTool = extensionRegistryTools.find((tool) => tool.name === 'extension_info');

    expect(infoTool?.inputSchema.required).toEqual(['pluginId']);
    expect(infoTool?.annotations?.readOnlyHint).toBe(true);
  });
});
