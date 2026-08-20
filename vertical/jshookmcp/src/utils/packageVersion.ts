/**
 * Single source of truth for the package version.
 *
 * Walks up from a module URL to the nearest `package.json` and returns its
 * `version`, working in both source (`src/utils/*.ts`) and bundled/dist
 * layouts. Falls back to `npm_package_version`, then `'0.0.0'`.
 *
 * Pass `import.meta.url` from the calling module. Never hard-code the version —
 * it must always track `package.json` so extension compat ranges resolve
 * against the real core version.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function getPackageVersion(moduleUrl: string): string {
  try {
    // Walk up from the module file to find the nearest package.json with a version.
    let dirUrl = new URL('.', moduleUrl);
    for (let i = 0; i < 5; i++) {
      try {
        const candidate = fileURLToPath(new URL('package.json', dirUrl));
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        // Not found at this level — keep walking up
      }
      const parentUrl = new URL('../', dirUrl);
      if (parentUrl.href === dirUrl.href) break; // filesystem root
      dirUrl = parentUrl;
    }
  } catch {
    // URL resolution failed — fall through
  }
  return process.env.npm_package_version ?? '0.0.0';
}
