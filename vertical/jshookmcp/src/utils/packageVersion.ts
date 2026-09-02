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

/**
 * Loose semver shape: major.minor.patch with optional pre-release/build
 * suffix. Both `package.json` versions and the `npm_package_version` env
 * fallback must satisfy this before being trusted.
 */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function isValidVersion(version: string): boolean {
  return SEMVER_RE.test(version.trim());
}

export function getPackageVersion(moduleUrl: string): string {
  try {
    // Walk up from the module file to find the nearest package.json with a
    // valid version. Unbounded: stops only at the filesystem root, so deeply
    // nested install layouts (node_modules chains deeper than a few levels)
    // still resolve.
    let dirUrl = new URL('.', moduleUrl);
    while (true) {
      try {
        const candidate = fileURLToPath(new URL('package.json', dirUrl));
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
        const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
        if (isValidVersion(version)) return version;
      } catch {
        // Not found or unreadable at this level — keep walking up
      }
      const parentUrl = new URL('../', dirUrl);
      if (parentUrl.href === dirUrl.href) break; // filesystem root
      dirUrl = parentUrl;
    }
  } catch {
    // URL resolution failed — fall through
  }
  const envVersion = process.env.npm_package_version?.trim() ?? '';
  return isValidVersion(envVersion) ? envVersion : '0.0.0';
}
