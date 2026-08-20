/**
 * Regression tests for the dart-inspector tool definitions' source-selection
 * constraints.
 *
 * Bug 1: `dart_create_session` declared `.required('apkPath|libappPath')` —
 * a literal `|`-joined name the JSON-Schema builder emits as a required entry
 * that matches NO declared property, so the constraint was silently a no-op.
 * Bug 2: the session-based tools (dart_load_snapshot, dart_list_functions,
 * ...) had no required-source enforcement in the schema layer; their handlers
 * must validate "sessionId OR apkPath OR libappPath".
 *
 * JSON Schema cannot express a one-of-required OR constraint, so the fix is:
 *  - drop the phantom `'apkPath|libappPath'` required entry (the handler
 *    already validates the OR),
 *  - assert the handler-layer VALIDATION for every session-based tool.
 */

import { describe, expect, it } from 'vitest';
import { dartInspectorTools } from '@server/domains/dart-inspector/definitions';
import { DartInspectorHandlers } from '@server/domains/dart-inspector/handlers.impl';
import { getResponseText } from '@tests/test-utils';

function toolByName(name: string) {
  return dartInspectorTools.find((t) => t.name === name);
}

const SESSION_TOOLS = [
  'dart_load_snapshot',
  'dart_list_functions',
  'dart_call_function',
  'dart_inspect_object_pool',
  'dart_trace_execution',
  'dart_call_graph',
  'dart_pc_descriptors',
];

describe('dart-inspector definitions — source constraints', () => {
  it('dart_create_session does not declare the phantom apkPath|libappPath required entry', () => {
    const tool = toolByName('dart_create_session')!;
    const required = (tool.inputSchema as { required?: string[] }).required ?? [];
    expect(required).not.toContain('apkPath|libappPath');
  });

  it('every tool with required entries names only declared properties', () => {
    for (const tool of dartInspectorTools) {
      const schema = tool.inputSchema as {
        required?: string[];
        properties: Record<string, unknown>;
      };
      for (const name of schema.required ?? []) {
        expect(
          schema.properties[name],
          `tool ${tool.name}: required entry "${name}" must be a declared property`,
        ).toBeDefined();
      }
    }
  });

  it('session-based tools keep their source params optional in the schema (OR constraint is handler-side)', () => {
    for (const name of SESSION_TOOLS) {
      const schema = toolByName(name)!.inputSchema as { required?: string[] };
      // sessionId/apkPath/libappPath are all optional — the handler enforces
      // "at least one" (JSON Schema cannot express the OR).
      expect(schema.required ?? []).not.toContain('sessionId');
      expect(schema.required ?? []).not.toContain('apkPath');
      expect(schema.required ?? []).not.toContain('libappPath');
    }
  });
});

describe('dart-inspector handlers — source validation', () => {
  const handlers = new DartInspectorHandlers();

  async function validationError(call: () => Promise<unknown>): Promise<string | null> {
    const response = await call();
    const text = getResponseText(response as Parameters<typeof getResponseText>[0]);
    const body = JSON.parse(text) as { success?: boolean; error?: string };
    return body.success === false ? (body.error ?? '') : null;
  }

  it('dart_create_session validates apkPath-or-libappPath', async () => {
    const error = await validationError(() => handlers.handleDartCreateSession({}));
    expect(error).toMatch(/apkPath or libappPath/i);
  });

  it('dart_load_snapshot validates sessionId-or-path', async () => {
    const error = await validationError(() => handlers.handleDartLoadSnapshot({}));
    expect(error).toMatch(/sessionId, or apkPath\/libappPath/i);
  });

  it('dart_list_functions validates sessionId-or-path', async () => {
    const error = await validationError(() => handlers.handleDartListFunctions({}));
    expect(error).toMatch(/sessionId, or apkPath\/libappPath/i);
  });

  it('dart_call_graph validates sessionId-or-path', async () => {
    const error = await validationError(() => handlers.handleDartCallGraph({}));
    expect(error).toMatch(/sessionId, or apkPath\/libappPath/i);
  });

  it('dart_inspect_object_pool validates sessionId-or-path', async () => {
    const error = await validationError(() =>
      handlers.handleDartInspectObjectPool({ poolAddress: '0x1000' }),
    );
    expect(error).toMatch(/sessionId, or apkPath\/libappPath/i);
  });

  it('dart_call_function validates sessionId-or-path', async () => {
    const error = await validationError(() =>
      handlers.handleDartCallFunction({ functionAddress: '0x1000' }),
    );
    expect(error).toMatch(/sessionId, or apkPath\/libappPath/i);
  });

  it('dart_pc_descriptors validates sessionId-or-path', async () => {
    const error = await validationError(() => handlers.handleDartPcDescriptors({}));
    expect(error).toMatch(/sessionId, or apkPath\/libappPath/i);
  });

  it('dart_trace_execution validates sessionId-or-path', async () => {
    const error = await validationError(() =>
      handlers.handleDartTraceExecution({ functionAddress: '0x1000' }),
    );
    expect(error).toMatch(/sessionId, or apkPath\/libappPath/i);
  });
});
