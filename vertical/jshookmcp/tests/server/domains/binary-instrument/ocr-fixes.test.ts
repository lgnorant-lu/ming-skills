/**
 * OCR-scan C+H fix regression tests for the binary-instrument domain.
 *
 * Covers:
 *  - #3109 (listTags): `<activity-alias>` prefix-matching `<activity\b` must not
 *    truncate activity collection (non-self-closing alias before activities).
 *  - #3107 (counts): `summarizeManifestXml().counts` must report the real
 *    component tag counts, not the dedup-and-limited `components` lengths.
 *  - #3076 (cross-realm Maps): `isServerContext` / `hasInstalledLegacyPlugin`
 *    must duck-type `Map` so Maps from another JS realm are accepted.
 *  - #3056 (response shape): frida handlers must return the MCP content
 *    envelope (`{ content: [{ type: 'text', text }] }`) on every path, so
 *    callers parsing `response.content[0].text` never receive a bare object.
 */

import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { BinaryInstrumentHandlers } from '@server/domains/binary-instrument/handlers';
import type { BinaryInstrumentState } from '@server/domains/binary-instrument/handlers/shared';
import {
  hasInstalledLegacyPlugin,
  isServerContext,
} from '@server/domains/binary-instrument/handlers/shared';
import {
  listTags,
  summarizeManifestXml,
} from '@server/domains/binary-instrument/shared/apk-manifest-utils';
import type { MCPServerContext } from '@server/MCPServer.context';
import { R } from '@server/domains/shared/ResponseBuilder';

class StubFridaSession {
  private readonly options: {
    available: boolean;
    sessionId?: string;
    diagnosticsStatus?: 'attached' | 'detached' | 'error';
    lastError?: string;
    scriptError?: string;
  };
  constructor(options: {
    available: boolean;
    sessionId?: string;
    diagnosticsStatus?: 'attached' | 'detached' | 'error';
    lastError?: string;
    scriptError?: string;
  }) {
    this.options = options;
  }

  async getAvailability() {
    return this.options.available
      ? { available: true, path: 'frida', version: 'mock' }
      : { available: false, reason: 'mock frida unavailable' };
  }

  async attach(target: string) {
    if (target === 'fail') throw new Error('attach failed');
    return this.options.sessionId ?? 'session-1';
  }

  async spawn(target: string) {
    if (target === 'fail') throw new Error('spawn failed');
    return this.options.sessionId ?? 'session-1';
  }

  async resume() {
    return this.options.scriptError
      ? { output: '', error: this.options.scriptError }
      : { output: 'resumed' };
  }

  useSession(sessionId: string) {
    return sessionId === this.options.sessionId;
  }

  async detach() {
    return undefined;
  }

  async enumerateModules() {
    return [{ name: 'app.exe', base: '0x1000', size: 4096, path: '/tmp/app.exe' }];
  }

  async executeScript(script: string) {
    return this.options.scriptError
      ? { output: '', error: this.options.scriptError }
      : { output: `ran:${script}` };
  }

  async enumerateFunctions(moduleName: string) {
    return [{ name: `${moduleName}!main`, address: '0x1010', size: 16 }];
  }

  async findSymbols(pattern: string) {
    return [{ name: pattern, address: '0x2020', demangled: pattern }];
  }

  async memoryScan() {
    return [];
  }

  async memoryRead() {
    return { base64: '', bytes: 0 };
  }

  getSessionDiagnostics(sessionId: string) {
    if (sessionId !== this.options.sessionId) return undefined;
    return {
      status: this.options.diagnosticsStatus ?? 'attached',
      lastError: this.options.lastError,
    };
  }
}

function createHandlersWithState(
  statePatch: Partial<BinaryInstrumentState>,
): BinaryInstrumentHandlers {
  const handlers = new BinaryInstrumentHandlers();
  Object.assign((handlers as unknown as { state: BinaryInstrumentState }).state, statePatch);
  return handlers;
}

function parseContent(response: unknown): { success?: boolean; [key: string]: unknown } {
  expect(response).toBeTypeOf('object');
  const content = (response as { content?: unknown }).content;
  expect(Array.isArray(content), 'handler must return { content: [...] }').toBe(true);
  const first = (content as Array<{ type?: string; text?: string }>)[0];
  expect(first?.type).toBe('text');
  return JSON.parse(first?.text ?? '') as { success?: boolean; [key: string]: unknown };
}

function unavailableHandlers(): BinaryInstrumentHandlers {
  return createHandlersWithState({
    fridaSession: new StubFridaSession({ available: false }) as never,
  });
}

function sessionHandlers(): BinaryInstrumentHandlers {
  return createHandlersWithState({
    fridaSession: new StubFridaSession({
      available: true,
      sessionId: 'session-1',
      scriptError: 'script failed',
    }) as never,
  });
}

describe('listTags (apk-manifest-utils)', () => {
  it('does not prefix-match <activity-alias> when collecting <activity> tags', () => {
    const xml =
      '<manifest><application>' +
      '<activity-alias android:name=".Alias" targetActivity=".Main"></activity-alias>' +
      '<activity android:name=".Main"/>' +
      '</application></manifest>';

    const activities = listTags(xml, 'activity');
    expect(activities).toHaveLength(1);
    expect(activities[0]).toContain('android:name=".Main"');
  });

  it('collects self-closing alias tags separately from activity tags', () => {
    const xml =
      '<manifest><application>' +
      '<activity-alias android:name=".Alias" targetActivity=".Main"/>' +
      '<activity android:name=".Main"/>' +
      '</application></manifest>';

    const aliases = listTags(xml, 'activity-alias');
    expect(aliases).toHaveLength(1);
    const activities = listTags(xml, 'activity');
    expect(activities).toHaveLength(1);
    expect(activities[0]).toContain('android:name=".Main"');
  });
});

describe('summarizeManifestXml counts (#3107)', () => {
  it('reports real activity tag counts even when dedup/limit truncates components', () => {
    const names = Array.from({ length: 600 }, (_, i) => `com.example.a${i}`);
    const xml =
      '<manifest><application>' +
      names.map((name) => `<activity android:name="${name}"/>`).join('') +
      '</application></manifest>';

    const summary = summarizeManifestXml(xml);
    expect(summary.components.activities).toHaveLength(500); // dedup + limit
    expect(summary.counts.activities).toBe(600); // real tag count
  });

  it('reports real service counts matching the component list for small manifests', () => {
    const xml =
      '<manifest><application>' +
      '<service android:name="com.example.Svc1"/>' +
      '<service android:name="com.example.Svc2"/>' +
      '</application></manifest>';

    const summary = summarizeManifestXml(xml);
    expect(summary.counts.services).toBe(2);
    expect(summary.components.services).toHaveLength(2);
  });
});

describe('cross-realm Map duck-typing (#3076)', () => {
  const crossRealmMap = vm.runInNewContext('new Map()') as Map<string, unknown>;

  it('isServerContext accepts Maps originating from another JS realm', () => {
    const context = {
      extensionPluginsById: crossRealmMap,
      extensionPluginRuntimeById: crossRealmMap,
    } as unknown as MCPServerContext;
    expect(isServerContext(context)).toBe(true);
  });

  it('hasInstalledLegacyPlugin accepts a cross-realm Map', () => {
    const crossRealmWithPlugin = vm.runInNewContext(
      'new Map([["plugin_frida_bridge", {}]])',
    ) as Map<string, unknown>;
    const contextWithCrossRealm = { extensionPluginsById: crossRealmWithPlugin } as never;
    expect(hasInstalledLegacyPlugin(contextWithCrossRealm, 'plugin_frida_bridge')).toBe(true);
    const contextWithEmpty = { extensionPluginsById: crossRealmMap } as never;
    expect(hasInstalledLegacyPlugin(contextWithEmpty, 'plugin_frida_bridge')).toBe(false);
  });

  it('isServerContext still rejects non-Map values', () => {
    expect(isServerContext({ extensionPluginsById: {}, extensionPluginRuntimeById: {} })).toBe(
      false,
    );
  });
});

describe('frida handlers response envelope (#3056)', () => {
  it.each([
    ['handleFridaRunScript', { sessionId: 'session-1', script: '1+1' }],
    ['handleFridaSpawn', { target: 'com.example.app' }],
    ['handleFridaResume', { sessionId: 'session-1' }],
    ['handleFridaEnumerateFunctions', { sessionId: 'session-1', moduleName: 'libx.so' }],
    ['handleFridaFindSymbols', { sessionId: 'session-1', pattern: 'JNI' }],
    ['handleFridaMemoryScan', { sessionId: 'session-1', pattern: '4141' }],
    ['handleFridaMemoryRead', { sessionId: 'session-1', address: '0x1000', size: 16 }],
  ] as const)('%s returns the content envelope when Frida is unavailable', async (method, args) => {
    const handlers = unavailableHandlers();
    const invoke = (handlers as unknown as Record<string, (a: object) => Promise<unknown>>)[method];
    if (typeof invoke !== 'function') throw new Error(`missing handler: ${method}`);
    const result = await invoke.call(handlers, args);
    const parsed = parseContent(result);
    expect(parsed.success).toBe(false);
    expect(parsed.available).toBe(false);
  });

  it('handleFridaRunScript returns the content envelope when the session is unknown', async () => {
    const handlers = sessionHandlers();
    const result = await handlers.handleFridaRunScript({ sessionId: 'missing', script: '1+1' });
    const parsed = parseContent(result);
    expect(parsed.success).toBe(false);
    expect(parsed.capability).toBe('frida_session');
  });

  it('success paths keep returning the same envelope', async () => {
    const handlers = sessionHandlers();
    const result = await handlers.handleFridaRunScript({ sessionId: 'session-1', script: '1+1' });
    const parsed = parseContent(result);
    expect(parsed.success).toBe(false); // scriptError stub — still inside envelope
    expect(R.parse(result as never)).toMatchObject({ execution: { error: 'script failed' } });
  });
});
