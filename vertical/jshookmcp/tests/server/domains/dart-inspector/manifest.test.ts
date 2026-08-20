/**
 * Manifest contract tests for the dart-inspector domain.
 *
 * Validates the DomainManifest shape, profile membership, registrations,
 * and the lazy `ensure()` factory (instance caching + idempotence).
 */
import { describe, it, expect } from 'vitest';
import manifest from '@server/domains/dart-inspector/manifest';
import type { MCPServerContext } from '@server/MCPServer.context';
import { DartInspectorHandlers } from '@server/domains/dart-inspector/handlers';

function makeMockCtx(): MCPServerContext {
  return {} as MCPServerContext;
}

describe('dart-inspector manifest', () => {
  it('has the correct domain shape', () => {
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.version).toBe(1);
    expect(manifest.domain).toBe('dart-inspector');
    expect(manifest.depKey).toBe('dartInspectorHandlers');
  });

  it('is only enabled in the full profile (heavy file I/O)', () => {
    expect(manifest.profiles).toContain('full');
    expect(manifest.profiles).not.toContain('workflow');
    expect(manifest.profiles).not.toContain('search');
  });

  it('registers the dart_strings_extract, dart_smi_scan, dart_symbolize, flutter_packages_detect, dart_snapshot_header_parse, dart_version_fingerprint, dart_object_pool_dump, dart_load_snapshot, dart_list_functions, dart_call_function, dart_inspect_object_pool, dart_trace_execution, dart_call_graph, dart_pc_descriptors tools', () => {
    const toolNames = manifest.registrations.map((r) => r.tool.name);
    expect(toolNames).toContain('dart_strings_extract');
    expect(toolNames).toContain('dart_smi_scan');
    expect(toolNames).toContain('dart_symbolize');
    expect(toolNames).toContain('flutter_packages_detect');
    expect(toolNames).toContain('dart_snapshot_header_parse');
    expect(toolNames).toContain('dart_version_fingerprint');
    expect(toolNames).toContain('dart_object_pool_dump');
    expect(toolNames).toContain('dart_load_snapshot');
    expect(toolNames).toContain('dart_list_functions');
    expect(toolNames).toContain('dart_call_function');
    expect(toolNames).toContain('dart_inspect_object_pool');
    expect(toolNames).toContain('dart_trace_execution');
    expect(toolNames).toContain('dart_call_graph');
    expect(toolNames).toContain('dart_pc_descriptors');
    expect(toolNames).toContain('dart_create_session');
    expect(toolNames).toContain('dart_destroy_session');
    expect(toolNames).toHaveLength(16);
  });

  it('every registration is bound to the dart-inspector domain', () => {
    for (const reg of manifest.registrations) {
      expect(reg.domain).toBe('dart-inspector');
      expect(typeof reg.bind).toBe('function');
    }
  });

  it('ensure() seeds ctx.dartInspectorHandlers and returns the instance', async () => {
    const ctx = makeMockCtx();
    const handler = await manifest.ensure(ctx);

    expect(handler).toBeInstanceOf(DartInspectorHandlers);
    expect(typeof handler.handleDartStringsExtract).toBe('function');
    expect(ctx.dartInspectorHandlers).toBe(handler);
  });

  it('ensure() is idempotent — repeat calls return the same instance', async () => {
    const ctx = makeMockCtx();
    const first = await manifest.ensure(ctx);
    const second = await manifest.ensure(ctx);
    expect(second).toBe(first);
  });
});
