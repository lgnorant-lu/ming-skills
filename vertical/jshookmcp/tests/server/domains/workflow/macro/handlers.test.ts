import { describe, expect, it, vi, beforeEach } from 'vitest';
const { mockMacroExecute } = vi.hoisted(() => ({
  mockMacroExecute: vi.fn(async (_def?: unknown, _input?: unknown, _policy?: unknown) => ({
    ok: true,
    durationMs: 100,
  })),
}));

import { MacroToolHandlers } from '@server/domains/workflow/macro/handlers';
import { setGlobalRetryPolicy } from '@server/domains/workflow/retry-policy';

vi.mock('@server/macros/MacroRunner', () => {
  return {
    MacroRunner: class {
      async execute(def: unknown, input: unknown, policy: unknown) {
        return mockMacroExecute(def, input, policy);
      }
      formatProgressReport() {
        return 'Mocked Report';
      }
    },
  };
});

vi.mock('@server/macros/MacroConfigLoader', () => {
  return {
    MacroConfigLoader: {
      loadFromDirectory() {
        return Promise.resolve([
          {
            id: 'custom_macro',
            displayName: 'Custom Macro',
            description: 'Custom',
            tags: [],
            steps: [],
          },
        ]);
      },
    },
  };
});

vi.mock('@utils/outputPaths', () => ({
  getProjectRoot: () => '/mock/project/root',
}));

import { MacroConfigLoader } from '@server/macros/MacroConfigLoader';

describe('MacroToolHandlers', () => {
  let handlers: MacroToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMacroExecute.mockResolvedValue({ ok: true, durationMs: 100 });
    const map = new Map<string, any>();
    const ctx: any = {
      getDomainInstance: (key: string) => map.get(key),
      setDomainInstance: (key: string, inst: any) => map.set(key, inst),
      getToolRegistry: () => ({ getAnnotationsForTool: () => [] }),
    };
    handlers = new MacroToolHandlers(ctx);
  });

  describe('handleListMacros', () => {
    it('should list built-in and custom macros', async () => {
      const result = (await handlers.handleListMacros()) as any;
      expect(result.content[0].type).toBe('text');
      const data = JSON.parse(result.content[0].text);
      expect(data.macros).toBeInstanceOf(Array);
      expect(data.count).toBeGreaterThan(0);
      expect(data.macros.find((m: any) => m.id === 'custom_macro')).toBeDefined();
    });

    it('keeps list wrapper output un-nested', async () => {
      const result = (await handlers.handleListMacrosTool()) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.macros).toBeInstanceOf(Array);
      expect(data.content).toBeUndefined();
    });

    it('should ignore user macro loading errors and fallback to built-ins', async () => {
      vi.spyOn(MacroConfigLoader, 'loadFromDirectory').mockRejectedValueOnce(
        new Error('dir issue'),
      );
      const result = (await handlers.handleListMacros()) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.macros).toBeInstanceOf(Array);
      expect(data.macros.find((m: any) => m.id === 'custom_macro')).toBeUndefined();
    });

    it('should cache macros after first load', async () => {
      const spy = vi.spyOn(handlers as any, 'ensureMacrosLoaded');
      await handlers.handleListMacros();
      await handlers.handleListMacros();
      expect(spy).toHaveBeenCalledTimes(2);
      // It should return the cached promise/result on second call
    });
  });

  describe('handleRunMacro', () => {
    it('should return error if macroId is missing', async () => {
      const result = (await handlers.handleRunMacro({})) as any;
      expect(result.content[0].text).toContain('macroId parameter is required');
    });

    it('keeps run wrapper validation output un-nested', async () => {
      const result = (await handlers.handleRunMacroTool({})) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data).toMatchObject({
        ok: false,
        error: 'macroId parameter is required',
      });
      expect(data.content).toBeUndefined();
    });

    it('should return error if macro not found', async () => {
      const result = (await handlers.handleRunMacro({ macroId: 'non_existent_macro' })) as any;
      expect(result.content[0].text).toContain('not found');
    });

    it('should execute existing macro and return report', async () => {
      // First call list to ensure loaded (though handleRunMacro also loads)
      const result = (await handlers.handleRunMacro({ macroId: 'custom_macro' })) as any;
      expect(result.content[0].text).toBe('Mocked Report');
    });

    it('passes the global retry policy into macro execution', async () => {
      const policy = { maxAttempts: 4, backoffMs: 250, multiplier: 3 };
      setGlobalRetryPolicy(policy);

      await handlers.handleRunMacro({ macroId: 'custom_macro' });

      expect(mockMacroExecute).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'custom_macro' }),
        undefined,
        policy,
      );
    });
  });
});
