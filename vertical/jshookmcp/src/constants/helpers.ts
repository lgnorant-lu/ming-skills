/**
 * Backward-compatible facade for constant modules.
 * Runtime parsing and environment bootstrapping live in the config layer.
 *
 * Bootstrapping is deterministic by construction: the `export ... from
 * '@src/config/environment'` below ESM-evaluates `environment.ts`, whose module
 * body calls `bootstrapRuntimeEnv()` (and imports `env-bootstrap`, which also
 * bootstraps at load). So any module that imports a constant here gets `.env`
 * loaded before that constant's module body reads the runtime environment —
 * no reliance on the entry point importing `env-bootstrap` first.
 */
export { autoInt, bool, cpuCount, csv, float, int, list, str } from '@src/config/environment';
