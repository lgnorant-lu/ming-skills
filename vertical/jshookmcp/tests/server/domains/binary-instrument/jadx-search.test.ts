/**
 * jadx_search_code — merged from the former standalone jadx-search domain into
 * binary-instrument. Validates the MCP envelope and argument-handling edges via
 * the BinaryInstrumentHandlers facade. The engine selection (ripgrep vs Node
 * fallback) is exercised in module-level tests; here we accept either.
 *
 * Kept in a dedicated file (no node:fs / child_process / yauzl mocks) so the
 * tool's real filesystem search over the fixture runs unmocked.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BinaryInstrumentHandlers } from '@server/domains/binary-instrument/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'jadx-search', 'jadx-out');

interface ParsedResponse {
  success: boolean;
  engine?: string;
  totalMatches?: number;
  filesMatched?: number;
  matches?: unknown[];
  truncated?: boolean;
}

function makeHandlers(): BinaryInstrumentHandlers {
  return new BinaryInstrumentHandlers();
}

async function call(
  handlers: BinaryInstrumentHandlers,
  args: Record<string, unknown>,
): Promise<ParsedResponse> {
  const resp = await handlers.handleJadxSearchCode(args);
  return R.parse<ParsedResponse>(resp as Parameters<typeof R.parse>[0]);
}

describe('binary-instrument · handleJadxSearchCode (merged from jadx-search)', () => {
  it('returns a successful result for a valid query', async () => {
    const result = await call(makeHandlers(), { decompileDir: FIXTURE_DIR, query: 'AES' });
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(['ripgrep', 'node-fallback']).toContain(result.engine);
  });

  it('honours custom contextLines on a literal query', async () => {
    const result = await call(makeHandlers(), {
      decompileDir: FIXTURE_DIR,
      query: 'Cipher.getInstance',
      literal: true,
      contextLines: 1,
    });
    expect(result.success).toBe(true);
    expect((result.matches as Array<{ context?: unknown }>).every((m) => 'context' in m)).toBe(
      true,
    );
  });

  it('caps results when maxResults is supplied', async () => {
    const result = await call(makeHandlers(), {
      decompileDir: FIXTURE_DIR,
      query: 'public',
      maxResults: 1,
    });
    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBe(1);
    expect(result.truncated).toBe(true);
  });

  // Argument validation throws (binary-instrument convention: the server layer
  // maps the thrown error to a JSON-RPC error, unlike the old handleSafe path).
  it('throws on missing query', async () => {
    await expect(
      makeHandlers().handleJadxSearchCode({ decompileDir: FIXTURE_DIR }),
    ).rejects.toThrow(/query/i);
  });

  it('throws on missing decompileDir', async () => {
    await expect(makeHandlers().handleJadxSearchCode({ query: 'AES' })).rejects.toThrow(
      /decompileDir or apkPath/,
    );
  });

  it('accepts apkPath alongside decompileDir as contextual metadata', async () => {
    const result = await call(makeHandlers(), {
      decompileDir: FIXTURE_DIR,
      query: 'AES',
      apkPath: '/tmp/whatever.apk',
    });
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThan(0);
  });

  it('rejects non-array globs', async () => {
    await expect(
      makeHandlers().handleJadxSearchCode({
        decompileDir: FIXTURE_DIR,
        query: 'AES',
        globs: 'not-an-array',
      }),
    ).rejects.toThrow(/globs/);
  });

  it('rejects globs containing non-string entries', async () => {
    await expect(
      makeHandlers().handleJadxSearchCode({
        decompileDir: FIXTURE_DIR,
        query: 'AES',
        globs: ['**/*.java', 42],
      }),
    ).rejects.toThrow(/globs/);
  });
});
