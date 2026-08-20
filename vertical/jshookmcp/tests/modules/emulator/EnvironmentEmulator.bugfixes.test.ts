import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@modules/emulator/BrowserEnvironmentRules', () => ({
  BrowserEnvironmentRulesManager: class {
    getAllRules() {
      return [];
    }
  },
}));

import { EnvironmentEmulator } from '@modules/emulator/EnvironmentEmulator';

describe('EnvironmentEmulator bug fixes', () => {
  let emulator: EnvironmentEmulator;

  beforeEach(() => {
    vi.clearAllMocks();
    emulator = new EnvironmentEmulator();
  });

  it('detects invoked APIs as functions (not bare property strings)', async () => {
    const result = await emulator.analyze({
      code: 'window.fetch("https://x"); document.querySelector("a");',
    } as any);

    const missing = result.missingAPIs ?? [];
    const fetchMissing = missing.find((m) => m.path === 'window.fetch');
    const queryMissing = missing.find((m) => m.path === 'document.querySelector');

    // Both are invoked — they must be classified as functions so the
    // suggestion is a function stub rather than `= null`.
    expect(fetchMissing?.type).toBe('function');
    expect(queryMissing?.type).toBe('function');
  });

  it('still classifies non-invoked element-typed APIs via the suffix heuristic', async () => {
    const result = await emulator.analyze({
      code: 'const el = document.activeElement;',
    } as any);

    const missing = result.missingAPIs ?? [];
    const elMissing = missing.find((m) => m.path === 'document.activeElement');
    // Not invoked and not ending in Element/List → falls back to property.
    expect(elMissing).toBeDefined();
    expect(['property', 'object']).toContain(elMissing?.type);
    // A plain property must never be suggested as a function stub.
    expect(elMissing?.type).not.toBe('function');
  });
});
