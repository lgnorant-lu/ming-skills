import { describe, expect, it } from 'vitest';
import { flattenIndexedSourceMap } from '@server/domains/sourcemap/handlers/sourcemap-parsing';
import { decodeMappings } from '@server/domains/sourcemap/handlers/shared';
import type { IndexedSourceMap } from '@server/domains/sourcemap/handlers/shared';

describe('flattenIndexedSourceMap', () => {
  it('merges section sources into a global sources array', () => {
    const indexed: IndexedSourceMap = {
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: { version: 3, sources: ['a.ts'], names: [], mappings: '' },
        },
        {
          offset: { line: 5, column: 0 },
          map: { version: 3, sources: ['b.ts'], names: [], mappings: '' },
        },
      ],
    };

    const flat = flattenIndexedSourceMap(indexed);
    expect(flat.version).toBe(3);
    expect(flat.sources).toEqual(['a.ts', 'b.ts']);
  });

  it('deduplicates sources shared across sections and aligns sourcesContent', () => {
    const indexed: IndexedSourceMap = {
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: {
            version: 3,
            sources: ['shared.ts', 'a-only.ts'],
            sourcesContent: ['shared body', 'a body'],
            names: [],
            mappings: '',
          },
        },
        {
          offset: { line: 2, column: 0 },
          map: {
            version: 3,
            sources: ['shared.ts', 'b-only.ts'],
            sourcesContent: ['shared body', 'b body'],
            names: [],
            mappings: '',
          },
        },
      ],
    };

    const flat = flattenIndexedSourceMap(indexed);
    expect(flat.sources).toEqual(['shared.ts', 'a-only.ts', 'b-only.ts']);
    expect(flat.sourcesContent).toEqual(['shared body', 'a body', 'b body']);
  });

  it('concatenates section names into a global names array', () => {
    const indexed: IndexedSourceMap = {
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: { version: 3, sources: ['a.ts'], names: ['alpha'], mappings: '' },
        },
        {
          offset: { line: 1, column: 0 },
          map: { version: 3, sources: ['b.ts'], names: ['beta'], mappings: '' },
        },
      ],
    };

    const flat = flattenIndexedSourceMap(indexed);
    expect(flat.names).toEqual(['alpha', 'beta']);
  });

  it('produces a decodable mappings string', () => {
    const indexed: IndexedSourceMap = {
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: { version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA' },
        },
        {
          offset: { line: 3, column: 0 },
          map: { version: 3, sources: ['b.ts'], names: [], mappings: 'AAAA' },
        },
      ],
    };

    const flat = flattenIndexedSourceMap(indexed);
    expect(typeof flat.mappings).toBe('string');
    const decoded = decodeMappings(flat.mappings);
    expect(decoded.length).toBeGreaterThan(0);
  });

  it('throws on an empty sections array', () => {
    expect(() => flattenIndexedSourceMap({ version: 3, sections: [] })).toThrow(
      /Indexed SourceMap has no sections/,
    );
  });
});
