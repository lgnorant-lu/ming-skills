import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeForCache } from '@utils/sanitizeForCache';
import { getProjectRoot } from '@utils/outputPaths';

const DATA_URI = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024);

function isPlaceholder(v: unknown): v is { _offload: Record<string, unknown> } {
  return typeof v === 'object' && v !== null && '_offload' in v;
}

describe('sanitizeForCache', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'sanitize-cache-'));
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  const opts = () => ({ outputDir: outDir });

  it('leaves primitives and small strings untouched (same reference)', () => {
    expect(sanitizeForCache(42, opts())).toBe(42);
    expect(sanitizeForCache('hello', opts())).toBe('hello');
    expect(sanitizeForCache(null, opts())).toBe(null);
    expect(sanitizeForCache(true, opts())).toBe(true);

    const obj = { a: 1, b: 'short', c: { d: [1, 2, 3] } };
    // Nothing oversized → same reference returned (cheap no-op).
    expect(sanitizeForCache(obj, opts())).toBe(obj);
  });

  it('replaces a data: URI with a file placeholder regardless of size', () => {
    const small = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
    const out = sanitizeForCache({ url: small }, opts()) as { url: unknown };

    expect(isPlaceholder(out.url)).toBe(true);
    if (isPlaceholder(out.url)) {
      expect(out.url._offload.type).toBe('file');
      expect(out.url._offload.mimeType).toBe('image/gif');
      expect(out.url._offload.sample).toContain('data:image/gif;base64,');
      expect(typeof out.url._offload.path).toBe('string');
    }
  });

  it('replaces strings over the threshold', () => {
    const big = 'x'.repeat(100 * 1024);
    const out = sanitizeForCache({ blob: big }, { ...opts(), threshold: 64 * 1024 }) as {
      blob: unknown;
    };
    expect(isPlaceholder(out.blob)).toBe(true);
  });

  it('reproduces issue #62: a 3MB data: URI in a request url shrinks dramatically', () => {
    const requests = [
      { url: DATA_URI, method: 'GET', requestId: 'r1' },
      { url: 'https://example.com/api', method: 'POST', requestId: 'r2' },
    ];
    const out = sanitizeForCache(requests, opts());
    const serialized = JSON.stringify(out);

    // Was ~3MB; must now be tiny (the only base64 left is the 128-char sample).
    expect(serialized.length).toBeLessThan(2000);
    // The multi-MB bulk is gone — no long run survives beyond the short sample.
    expect(serialized).not.toContain('A'.repeat(500));
    expect(isPlaceholder((out as any[])[0].url)).toBe(true);
    // Untouched normal URL stays intact.
    expect((out as any[])[1].url).toBe('https://example.com/api');
  });

  it('writes the decoded bytes to disk under artifacts/offloaded and they are retrievable', async () => {
    // Use the real default dir so the placeholder path is project-relative — this
    // is exactly what get_offloaded_data depends on. Clean up the file afterward.
    const png1px =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const out = sanitizeForCache({ img: png1px }) as unknown as {
      img: { _offload: { path: string } };
    };

    const relPath = out.img._offload.path;
    expect(relPath).toContain('artifacts/offloaded');

    const absPath = join(getProjectRoot(), relPath);
    try {
      const written = await readFile(absPath);
      // Decoded PNG starts with the 8-byte PNG signature.
      expect(written[0]).toBe(0x89);
      expect(written.subarray(1, 4).toString('ascii')).toBe('PNG');
    } finally {
      await rm(absPath, { force: true });
    }
  });

  it('is idempotent — sanitizing twice does not double-wrap', () => {
    const once = sanitizeForCache({ url: DATA_URI }, opts()) as unknown as {
      url: { _offload: unknown };
    };
    const twice = sanitizeForCache(once, opts());
    // Second pass returns the same reference (placeholder left untouched).
    expect(twice).toBe(once);
  });

  it('handles circular references without infinite recursion', () => {
    const node: Record<string, unknown> = { name: 'root', big: 'y'.repeat(100 * 1024) };
    node.self = node;
    const out = sanitizeForCache(node, { ...opts(), threshold: 64 * 1024 }) as Record<
      string,
      unknown
    >;
    expect(isPlaceholder(out.big)).toBe(true);
    // Cycle preserved (points back to the sanitized root or original — not crashed).
    expect(out.self).toBeDefined();
  });

  it('does not write a file when writeFile=false but still shrinks', () => {
    const out = sanitizeForCache({ url: DATA_URI }, { ...opts(), writeFile: false }) as unknown as {
      url: { _offload: { path: string; sample: string } };
    };
    expect(out.url._offload.path).toBe('');
    expect(out.url._offload.sample).toContain('data:image/png;base64,');
  });
});
