/**
 * Absolute `file://` URLs for the `@babel/*` packages used by the
 * Babel-backed deobfuscation workers (JScrambler + decode-string-array).
 *
 * Eval workers (`new Worker(source, { eval: true })`) have no `__dirname`, and
 * a packaged/global install has a cwd that is not the repo root, so a bare
 * `import('@babel/parser')` inside a worker would not resolve. The main thread
 * resolves each package via `createRequire(import.meta.url)` (which walks up
 * to `node_modules` regardless of cwd) and passes the `file://` URLs to the
 * worker, exactly like `resolveWebcrackUrl` in `./webcrack-worker`.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export interface BabelWorkerUrls {
  parser: string;
  traverse: string;
  generator: string;
  types: string;
}

let cachedBabelUrls: BabelWorkerUrls | undefined;

export function resolveBabelUrls(): BabelWorkerUrls {
  if (!cachedBabelUrls) {
    cachedBabelUrls = {
      parser: pathToFileURL(require.resolve('@babel/parser')).href,
      traverse: pathToFileURL(require.resolve('@babel/traverse')).href,
      generator: pathToFileURL(require.resolve('@babel/generator')).href,
      types: pathToFileURL(require.resolve('@babel/types')).href,
    };
  }
  return cachedBabelUrls;
}
