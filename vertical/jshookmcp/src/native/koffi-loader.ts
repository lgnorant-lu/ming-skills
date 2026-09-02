/**
 * Safe koffi loader.
 *
 * koffi is an optional native dependency whose native binding is compiled or
 * downloaded at install time. A static `import koffi from 'koffi'` crashes at
 * module-load time with MODULE_NOT_FOUND when the binding is absent (prebuild
 * download failed, `--no-optional` install, or compile failure), so the
 * availability checks in the FFI modules never get a chance to run and
 * memory/process domain activation dies outright.
 *
 * This module is the single load point. It resolves koffi once via dynamic
 * import (top-level await) and caches the result:
 *
 *   - `getKoffi()`    → the cached koffi module, or `null` when unavailable.
 *   - `requireKoffi()` → the cached module, throwing a descriptive error when
 *                        unavailable (for call sites that cannot degrade).
 *   - `isKoffiAvailable()` → `true` only when koffi was resolved.
 *
 * Three probe sites intentionally bypass this loader with their own
 * `import('koffi')` (each wrapped in try/catch, and each hits the ESM module
 * cache so the binding is not re-executed):
 *   - `native/NativeMemoryManager.availability.ts` (macOS libSystem probe)
 *   - `server/domains/memory/handlers/assemble.ts` (keystone.dll probe)
 *   - `server/domains/memory/handlers/byovd.ts` (driver-device probe)
 * They probe a *specific* native library on demand and degrade to a fallback,
 * rather than requiring the global loader's cached handle, so the single
 * load-point rule is documented here as "everything else".
 *
 * Dynamic `import('koffi')` (rather than `createRequire`) is deliberate: it
 * keeps `vi.mock('koffi', ...)` working in unit tests, which `createRequire` /
 * bare `require` bypass.
 */

type KoffiModule = typeof import('koffi');
export type Koffi = KoffiModule['default'];
export type KoffiLibraryHandle = ReturnType<Koffi['load']>;
export type KoffiCallable = ReturnType<KoffiLibraryHandle['func']>;

const koffi: Koffi | null = await import('koffi')
  .then((mod) => mod.default ?? null)
  .catch(() => null);

/**
 * Return the cached koffi module, or `null` when koffi is unavailable.
 * Never throws.
 */
export function getKoffi(): Koffi | null {
  return koffi;
}

/**
 * Return the cached koffi module, throwing a descriptive error when it is
 * unavailable. Use at FFI call sites that cannot degrade to a fallback.
 */
export function requireKoffi(): Koffi {
  if (!koffi) {
    throw new Error(
      'koffi native library is not available. Install it with: pnpm add koffi ' +
        '(or reinstall to rebuild the native binding) and restart the MCP server',
    );
  }
  return koffi;
}

/**
 * True only when the koffi module was successfully resolved.
 *
 * This is the *resolve-only* check. It does NOT verify that the resolved
 * binding can actually load a native library — for that stronger guarantee
 * (used to gate real FFI work) call `isKoffiBindingUsable()` from
 * `@native/Win32API`.
 */
export function isKoffiAvailable(): boolean {
  return koffi !== null;
}
