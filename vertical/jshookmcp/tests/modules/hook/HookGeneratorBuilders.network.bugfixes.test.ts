import { describe, expect, it } from 'vitest';
import { generateXHRHook } from '@modules/hook/HookGeneratorBuilders.core.generators.network';

describe('XHR hook block mode', () => {
  it('throws at open() instead of silently returning', () => {
    const code = generateXHRHook('block');
    expect(code).toContain('throw new Error("XHR blocked by hook")');
    // The old bare `return;` (no value, before originalOpen.apply) would leave
    // the XHR in UNSENT state, making a later send() throw InvalidStateError
    // inside page code.
    expect(code).not.toMatch(/return;\s*$/m);
  });

  it('keeps pass-through mode intact', () => {
    const code = generateXHRHook('log');
    expect(code).toContain('return originalOpen.apply(this, arguments);');
    expect(code).not.toContain('XHR blocked by hook');
  });
});
