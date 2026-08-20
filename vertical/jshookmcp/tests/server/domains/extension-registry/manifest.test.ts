import { describe, expect, it } from 'vitest';
import manifest from '@server/domains/extension-registry/manifest';

describe('extension-registry manifest', () => {
  it('registers install, info, and lifecycle tools', () => {
    const names = manifest.registrations.map((registration) => registration.tool.name);

    expect(names).toContain('extension_install');
    expect(names).toContain('extension_info');
    expect(names).toContain('extension_list_installed');
    expect(names).toContain('extension_execute_in_context');
  });

  it('routes extension install/info queries through workflow discovery', () => {
    expect(manifest.workflowRule?.tools).toContain('extension_install');
    expect(manifest.workflowRule?.tools).toContain('extension_info');
  });
});
