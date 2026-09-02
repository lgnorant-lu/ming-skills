import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';

const RUNTIME_PACKAGE_NAME = '@jshookmcp/jshook';

export interface RuntimeEnvBootstrapResult {
  projectRoot: string;
  envPath: string;
  loaded: boolean;
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function hasRuntimePackageJson(directory: string): boolean {
  try {
    const packageJsonPath = join(directory, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return false;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: unknown;
    };
    return packageJson.name === RUNTIME_PACKAGE_NAME;
  } catch {
    // Any fs error — including a test mock that only replaces a subset of
    // node:fs and doesn't export existsSync/readFileSync — must not crash
    // this walk. findRuntimeProjectRoot() runs unconditionally at module
    // import time (see bootstrapRuntimeEnv() below), so it is reachable from
    // any test file that merely imports something re-exporting
    // @src/config/environment, whether or not that test cares about config
    // resolution at all. Treating the error as "not the runtime package
    // root here" keeps the walk (and eventual cwd fallback) working exactly
    // as it would for a real, non-matching directory.
    return false;
  }
}

/**
 * Locate the package root from either a source module (`src/**`) or a flattened
 * production chunk (`dist/*.mjs`). The package name check prevents an unrelated
 * parent workspace package.json from being selected.
 */
export function findRuntimeProjectRoot(moduleUrl: string, fallback = process.cwd()): string {
  let current: string;
  try {
    current = dirname(fileURLToPath(moduleUrl));
  } catch {
    return normalize(resolve(fallback));
  }

  while (true) {
    if (hasRuntimePackageJson(current)) {
      return normalize(current);
    }

    const parent = dirname(current);
    if (parent === current) {
      return normalize(resolve(fallback));
    }
    current = parent;
  }
}

/** Package-root `.env` wins; installed/npx packages fall back to the caller cwd. */
export function resolveRuntimeEnvPath(projectRoot: string, cwd = process.cwd()): string {
  const candidates = [join(projectRoot, '.env'), join(cwd, '.env')];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (isRegularFile(normalized)) return normalized;
  }

  return normalize(candidates[0]!);
}

export const runtimeProjectRoot = findRuntimeProjectRoot(import.meta.url);

let bootstrapResult: RuntimeEnvBootstrapResult | undefined;

/** Load runtime environment exactly once, without overriding parent-process env. */
export function bootstrapRuntimeEnv(): RuntimeEnvBootstrapResult {
  if (bootstrapResult) {
    return bootstrapResult;
  }

  const envPath = resolveRuntimeEnvPath(runtimeProjectRoot);
  const result = dotenvConfig({ path: envPath, quiet: true, override: false });
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;

  bootstrapResult = {
    projectRoot: runtimeProjectRoot,
    envPath,
    loaded: !result.error,
  };

  if (result.error) {
    if (errorCode !== 'ENOENT') {
      console.error(`[Config] Warning: Failed to load .env from "${envPath}"`);
      console.error(`[Config] Error: ${result.error.message}`);
      console.error('[Config] Will use environment variables or defaults');
    }
  } else if (process.env.DEBUG === 'true') {
    console.info(`[Config] .env file loaded from "${envPath}" (debug mode)`);
  }

  return bootstrapResult;
}

// This module is deliberately side-effectful. Entrypoints import it before any
// business module so import-time constants observe values loaded from `.env`.
bootstrapRuntimeEnv();
