/**
 * v8_turbofan_graph handler tests — tests the handler layer (argument parsing,
 * validation, mode selection, result structuring) without spawning real V8.
 *
 * The TurboFanGraphParser/Collector tests cover the real V8 spawn path.
 */

import { describe, expect, it } from 'vitest';

describe('v8_turbofan_graph handler', () => {
  it('requires either source or traceDir', async () => {
    const { handleTurbofanGraph } =
      await import('@server/domains/v8-inspector/handlers/turbofan-graph');
    const res = await handleTurbofanGraph({});
    expect(res.success).toBe(false);
    expect(res.error).toContain('source');
    expect(res.error).toContain('traceDir');
    expect(res.functionCount).toBe(0);
  });

  it('returns failure for nonexistent traceDir', async () => {
    const { handleTurbofanGraph } =
      await import('@server/domains/v8-inspector/handlers/turbofan-graph');
    const res = await handleTurbofanGraph({
      traceDir: '/nonexistent/path/that/does/not/exist',
    });
    expect(res.success).toBe(false);
    expect(res.mode).toBe('directory');
    expect(res.functionCount).toBe(0);
  });

  it('accepts source mode with functionName', async () => {
    const { handleTurbofanGraph } =
      await import('@server/domains/v8-inspector/handlers/turbofan-graph');
    // A trivial function that may or may not get TurboFan-compiled
    const res = await handleTurbofanGraph({
      source: 'function trivialFn() { return 42; }',
      functionName: 'trivialFn',
      timeoutMs: 5000,
    });
    // Result may be success or failure depending on V8 optimization
    expect(typeof res.success).toBe('boolean');
    expect(res.mode).toBe('source');
    if (res.success) {
      expect(res.functionCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.functions)).toBe(true);
    }
  }, 15_000);

  it('accepts includePhases parameter', async () => {
    const { handleTurbofanGraph } =
      await import('@server/domains/v8-inspector/handlers/turbofan-graph');
    const res = await handleTurbofanGraph({
      source: 'function add(a,b) { return a + b; }',
      functionName: 'add',
      includePhases: true,
      maxNodesPerPhase: 5,
      timeoutMs: 5000,
    });
    if (res.success && res.functions.length > 0) {
      const fn = res.functions[0]!;
      expect(fn).toHaveProperty('phaseCount');
      expect(fn).toHaveProperty('totalNodeCount');
      expect(fn).toHaveProperty('opcodeHistogram');
      if (fn.phases) {
        expect(Array.isArray(fn.phases)).toBe(true);
        for (const phase of fn.phases) {
          expect(phase).toHaveProperty('name');
          expect(phase).toHaveProperty('nodeCount');
        }
      }
    }
  }, 15_000);

  it('accepts phaseFilter parameter', async () => {
    const { handleTurbofanGraph } =
      await import('@server/domains/v8-inspector/handlers/turbofan-graph');
    const res = await handleTurbofanGraph({
      source: 'function mul(a,b) { return a * b; }',
      functionName: 'mul',
      phaseFilter: 'inlining',
      includePhases: true,
      timeoutMs: 5000,
    });
    if (res.success && res.functions.length > 0 && res.functions[0]!.phases) {
      for (const phase of res.functions[0]!.phases) {
        expect(phase.name.toLowerCase()).toContain('inlining');
      }
    }
  }, 15_000);
});

describe('v8_turbofan_graph definition', () => {
  it('is registered in v8InspectorTools', async () => {
    const { v8InspectorTools } = await import('@server/domains/v8-inspector/definitions');
    const def = v8InspectorTools.find((t) => t.name === 'v8_turbofan_graph');
    expect(def).toBeTruthy();
    expect(def?.name).toBe('v8_turbofan_graph');
    expect(def?.description).toBeTruthy();
  });

  it('has source and traceDir as optional params (one required at handler level)', async () => {
    const { v8InspectorTools } = await import('@server/domains/v8-inspector/definitions');
    const def = v8InspectorTools.find((t) => t.name === 'v8_turbofan_graph')!;
    const schema = def.inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, unknown>;
    expect(props.source).toBeTruthy();
    expect(props.traceDir).toBeTruthy();
    expect(props.functionName).toBeTruthy();
    expect(props.includePhases).toBeTruthy();
    expect(props.timeoutMs).toBeTruthy();
    // No required fields — handler validates "source OR traceDir"
    expect(schema.required).toBeUndefined();
  });
});

describe('v8_turbofan_graph dispatch', () => {
  it('dispatches v8_turbofan_graph via the handler class', async () => {
    const { V8InspectorHandlers } = await import('@server/domains/v8-inspector/handlers/impl');
    // Construct with a minimal mock — no page controller needed for turbofan_graph
    const handlers = new V8InspectorHandlers({
      ctx: {} as any,
      client: {} as any,
    });
    // v8_turbofan_graph with empty args should fail validation, not throw
    const result = await handlers.handle('v8_turbofan_graph', {});
    expect(result).toBeTruthy();
    const res = result as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain('source');
  });
});
