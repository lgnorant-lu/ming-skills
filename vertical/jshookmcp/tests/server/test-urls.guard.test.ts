import { describe, expect, it } from 'vitest';
import { glob } from 'tinyglobby';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
// TS 7.0 ships no compiler API; parse with the project's own Babel toolchain.
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;

const ALLOWED_LITERAL_PATTERNS = [
  'tests/shared/test-urls.ts',
  'tests/server/test-urls.guard.test.ts',
  // Pre-existing scattered URLs — these files use placeholder hosts inline
  // and should be migrated to tests/shared/test-urls.ts in a follow-up.
  'tests/server/domains/network/har-protocol-integration.test.ts',
  'tests/server/domains/network/har-protocol.test.ts',
  'tests/server/domains/network/replay-http2.test.ts',
  'tests/server/domains/process/handlers.electron-attach-security.test.ts',
  'tests/server/domains/browser/page-evaluation.security.test.ts',
  'tests/server/domains/exploit-dev/caching-integration.test.ts',
  'tests/server/domains/exploit-dev/caching-benchmark.test.ts',
  'tests/server/domains/exploit-dev/caching.test.ts',
  'tests/server/domains/analysis/DeobfuscateCache.test.ts',
  'tests/modules/webgpu/CDPIntegration.test.ts',
  'tests/modules/webgpu/PageLockManager.test.ts',
];

function isPlaceholderHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'site' || normalized === 'test') return true;
  if (normalized.endsWith('.example.com')) return true;

  const suffix = normalized.split('.').pop();
  return suffix === 'example' || suffix === 'test' || suffix === 'local' || suffix === 'invalid';
}

function isDisallowedLiteralUrl(value: string): boolean {
  if (value.startsWith('https://vmoranv.github.io/jshookmcp/')) {
    return true;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    url.protocol !== 'http:' &&
    url.protocol !== 'https:' &&
    url.protocol !== 'ws:' &&
    url.protocol !== 'wss:' &&
    url.protocol !== 'ftp:'
  ) {
    return false;
  }

  return isPlaceholderHost(url.host);
}

function isDisallowedTemplateUrl(headText: string): boolean {
  const match = headText.match(/^(https?|wss?|ftp):\/\/([^/]+)(?:\/.*)?$/i);
  if (!match || !match[2]) return false;

  if (headText.startsWith('https://vmoranv.github.io/jshookmcp/')) {
    return true;
  }

  return isPlaceholderHost(match[2]);
}

function isAllowed(relPath: string): boolean {
  return ALLOWED_LITERAL_PATTERNS.includes(relPath.replace(/\\/g, '/'));
}

describe('test URL guard', () => {
  it(
    'does not allow scattered placeholder/test site URLs outside shared entrypoints',
    { timeout: 60_000 },
    async () => {
      const files = await glob(['tests/**/*.ts'], {
        cwd: process.cwd(),
        absolute: true,
      });

      const offenders: string[] = [];

      for (const file of files) {
        const relPath = relative(process.cwd(), file).replace(/\\/g, '/');
        if (isAllowed(relPath)) continue;

        const content = await readFile(file, 'utf8');
        const ast = parser.parse(content, {
          sourceType: 'unambiguous',
          // JSX parsing is enabled only for .tsx; in .ts it misreads generic
          // arrows like <T>(...) as JSX opening elements.
          plugins: file.endsWith('.tsx') ? ['jsx', 'typescript'] : ['typescript'],
        });
        let foundOffender = false;

        const flag = () => {
          foundOffender = true;
        };

        traverse(ast, {
          StringLiteral(path) {
            if (foundOffender) return;
            if (isDisallowedLiteralUrl(path.node.value)) flag();
          },
          TemplateLiteral(path) {
            if (foundOffender) return;
            const node = path.node;
            if (node.expressions.length === 0) {
              const text = node.quasis[0]?.value.cooked ?? '';
              if (isDisallowedLiteralUrl(text)) flag();
              return;
            }
            const headText =
              (node.quasis[0]?.value.cooked ?? '') +
              node.expressions
                .map((_, i) => '${}' + (node.quasis[i + 1]?.value.cooked ?? ''))
                .join('');
            if (isDisallowedTemplateUrl(headText)) flag();
          },
        });

        if (foundOffender) {
          offenders.push(relPath);
        }
      }

      expect(offenders).toEqual([]);
    },
  );
});
