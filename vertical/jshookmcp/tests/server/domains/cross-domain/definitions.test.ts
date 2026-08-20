import { describe, expect, it } from 'vitest';
import { crossDomainToolDefinitions } from '@server/domains/cross-domain/definitions';

describe('cross-domain definitions', () => {
  const getTool = (name: string) => crossDomainToolDefinitions.find((tool) => tool.name === name);

  it('should expose the real correlate_all inputs', async () => {
    const tool = getTool('cross_domain_correlate_all');
    expect(tool?.inputSchema.properties).toHaveProperty('sceneTree');
    expect(tool?.inputSchema.properties).toHaveProperty('jsObjects');
    expect(tool?.inputSchema.properties).toHaveProperty('mojoMessages');
    expect(tool?.inputSchema.properties).toHaveProperty('cdpEvents');
    expect(tool?.inputSchema.properties).toHaveProperty('networkRequests');
    expect(tool?.inputSchema.properties).toHaveProperty('syscallEvents');
    expect(tool?.inputSchema.properties).toHaveProperty('jsStacks');
    expect(tool?.inputSchema.properties).toHaveProperty('ghidraOutput');
    expect(tool?.inputSchema.properties).not.toHaveProperty('v8Objects');
  });

  it('should expose evidence query inputs', async () => {
    const tool = getTool('cross_domain_evidence_query');
    expect(tool?.inputSchema.required).toContain('queryType');
    expect(tool?.inputSchema.properties).toHaveProperty('value');
    expect(tool?.inputSchema.properties).toHaveProperty('metadataKey');
    expect(tool?.inputSchema.properties).toHaveProperty('direction');
    expect((tool?.inputSchema.properties?.direction as any)?.enum).toEqual(['forward', 'backward']);
    expect(tool?.inputSchema.properties?.limit).toMatchObject({
      maximum: 500,
    });
    expect((tool?.inputSchema.properties?.queryType as any)?.enum).toContain('network_url');
    expect((tool?.inputSchema.properties?.queryType as any)?.enum).toContain('metadata');
    expect((tool?.inputSchema.properties?.queryType as any)?.enum).toContain('chain');
  });
});
