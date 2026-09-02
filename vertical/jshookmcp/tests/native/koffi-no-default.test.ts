/**
 * Regression test: koffi must report unavailable when its default export is
 * missing (a corrupted install where the module resolves but `mod.default` is
 * `undefined`).
 *
 * `koffi-loader.ts` resolves koffi via `import('koffi').then((mod) => ...)`.
 * When the install is corrupted such that the module has named exports but no
 * `default`, the bare `mod.default` access yields `undefined`. Because
 * `isKoffiAvailable()` returns `koffi !== null`, `undefined` slipped through as
 * a false "available" — the FFI gate would then treat koffi as usable and
 * `requireKoffi()`/callers would blow up on `undefined.load`.
 */

import { describe, expect, it, vi } from 'vitest';

// Resolve koffi successfully but WITHOUT a default export.
vi.mock('koffi', () => ({
  default: undefined,
  load: vi.fn(),
}));

import { getKoffi, isKoffiAvailable, requireKoffi } from '@src/native/koffi-loader';

describe('koffi no-default graceful degradation', () => {
  it('isKoffiAvailable() returns false when the default export is missing', () => {
    expect(isKoffiAvailable()).toBe(false);
  });

  it('getKoffi() returns null when the default export is missing', () => {
    expect(getKoffi()).toBeNull();
  });

  it('requireKoffi() throws the descriptive error', () => {
    expect(() => requireKoffi()).toThrow(/koffi native library is not available/);
  });
});
