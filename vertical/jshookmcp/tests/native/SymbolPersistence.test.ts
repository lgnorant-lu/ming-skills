import { describe, it, expect } from 'vitest';
import {
  buildSymbolCatalog,
  mergeCatalog,
  catalogToStateValue,
  catalogFromStateValue,
  symbolCatalogKey,
  formatCatalogHint,
  type SymbolCatalog,
} from '../../src/native/SymbolPersistence';

function makeMockCatalog(overrides?: Partial<SymbolCatalog>): SymbolCatalog {
  return {
    symbols: [
      { name: 'Java_com_app_Sign', address: 0x5000, module: 'libnative.so' },
      { name: 'decrypt', address: 0x6200 },
    ],
    soPath: '/data/app/libnative.so',
    libraryHash: 'abc123def4567890',
    timestamp: Date.now(),
    sessions: ['sess-001'],
    ...overrides,
  };
}

describe('SymbolPersistence', () => {
  describe('buildSymbolCatalog', () => {
    it('builds catalog from exported symbols', () => {
      const resolveAddr = (name: string) => {
        if (name === 'func_a') return 0x4000;
        if (name === 'func_b') return 0x5000;
        return undefined;
      };

      const catalog = buildSymbolCatalog({
        soPath: '/test.so',
        symbols: ['func_a', 'func_b', 'func_c'],
        resolveAddress: resolveAddr,
        sessionId: 'sess-1',
        moduleName: 'test',
      });

      expect(catalog.symbols).toHaveLength(2);
      expect(catalog.symbols[0]!.name).toBe('func_a');
      expect(catalog.symbols[0]!.address).toBe(0x4000);
      expect(catalog.symbols[1]!.name).toBe('func_b');
      expect(catalog.symbols[1]!.address).toBe(0x5000);
      expect(catalog.sessions).toEqual(['sess-1']);
      expect(catalog.soPath).toBe('/test.so');
    });

    it('excludes symbols with undefined address', () => {
      const resolveAddr = () => undefined;

      const catalog = buildSymbolCatalog({
        soPath: '/test.so',
        symbols: ['func_a'],
        resolveAddress: resolveAddr,
        sessionId: 'sess-1',
      });

      expect(catalog.symbols).toHaveLength(0);
    });

    it('produces a stable libraryHash from soPath', () => {
      const resolveAddr = () => 0x1000;
      const c1 = buildSymbolCatalog({
        soPath: '/same/path.so',
        symbols: ['a'],
        resolveAddress: resolveAddr,
        sessionId: 's1',
      });
      const c2 = buildSymbolCatalog({
        soPath: '/same/path.so',
        symbols: ['a'],
        resolveAddress: resolveAddr,
        sessionId: 's2',
      });

      expect(c1.libraryHash).toBe(c2.libraryHash);
    });

    it('different paths produce different hashes', () => {
      const resolveAddr = () => 0x1000;
      const c1 = buildSymbolCatalog({
        soPath: '/path/a.so',
        symbols: ['a'],
        resolveAddress: resolveAddr,
        sessionId: 's1',
      });
      const c2 = buildSymbolCatalog({
        soPath: '/path/b.so',
        symbols: ['a'],
        resolveAddress: resolveAddr,
        sessionId: 's1',
      });

      expect(c1.libraryHash).not.toBe(c2.libraryHash);
    });
  });

  describe('mergeCatalog', () => {
    it('merges two catalogs with deduplication by name', () => {
      const existing = makeMockCatalog({
        symbols: [{ name: 'Java_com_app_Sign', address: 0x5000 }],
        sessions: ['sess-001'],
      });
      const incoming = makeMockCatalog({
        symbols: [
          { name: 'Java_com_app_Sign', address: 0x6000 }, // updated address
          { name: 'newFunc', address: 0x7000 },
        ],
        sessions: ['sess-002'],
      });

      const merged = mergeCatalog(existing, incoming);

      expect(merged.symbols).toHaveLength(2);
      // Incoming address wins
      const signSym = merged.symbols.find((s) => s.name === 'Java_com_app_Sign');
      expect(signSym!.address).toBe(0x6000);
      expect(merged.sessions).toEqual(['sess-001', 'sess-002']);
    });

    it('preserves symbols unique to existing catalog', () => {
      const existing = makeMockCatalog({
        symbols: [{ name: 'oldFunc', address: 0x4000 }],
        sessions: ['sess-001'],
      });
      const incoming = makeMockCatalog({
        symbols: [{ name: 'newFunc', address: 0x5000 }],
        sessions: ['sess-002'],
      });

      const merged = mergeCatalog(existing, incoming);

      expect(merged.symbols).toHaveLength(2);
      expect(merged.symbols.map((s) => s.name).toSorted()).toEqual(['newFunc', 'oldFunc']);
    });
  });

  describe('catalogToStateValue / catalogFromStateValue', () => {
    it('round-trips a catalog through state value format', () => {
      const catalog = makeMockCatalog();
      const stateValue = catalogToStateValue(catalog);

      expect(stateValue.libraryHash).toBe('abc123def4567890');
      expect(Array.isArray(stateValue.symbols)).toBe(true);
      expect((stateValue.symbols as Array<Record<string, unknown>>)[0]).toEqual({
        name: 'Java_com_app_Sign',
        address: '0x5000',
        module: 'libnative.so',
      });

      const restored = catalogFromStateValue(stateValue);
      expect(restored).not.toBeNull();
      expect(restored!.symbols).toHaveLength(2);
      expect(restored!.symbols[0]!.name).toBe('Java_com_app_Sign');
      expect(restored!.symbols[0]!.address).toBe(0x5000);
      expect(restored!.symbols[0]!.module).toBe('libnative.so');
      expect(restored!.soPath).toBe('/data/app/libnative.so');
    });

    it('returns catalog with empty symbols for empty state value', () => {
      const empty = catalogFromStateValue({});
      expect(empty).not.toBeNull();
      expect(empty!.symbols).toHaveLength(0);
    });

    it('handles non-array symbols gracefully', () => {
      const result = catalogFromStateValue({
        symbols: 'not-an-array',
        soPath: '',
        libraryHash: '',
        timestamp: 0,
        sessions: [],
      });
      expect(result).not.toBeNull();
      expect(result!.symbols).toHaveLength(0);
    });
  });

  describe('symbolCatalogKey', () => {
    it('returns namespace and key', () => {
      const result = symbolCatalogKey('abc123');
      expect(result.namespace).toBe('nemu_symbols');
      expect(result.key).toBe('abc123');
    });
  });

  describe('formatCatalogHint', () => {
    it('formats a human-readable hint', () => {
      const catalog = makeMockCatalog({
        symbols: [
          { name: 'f1', address: 0x1000 },
          { name: 'f2', address: 0x2000 },
        ],
      });
      const hint = formatCatalogHint(catalog);

      expect(hint).toContain('/data/app/libnative.so');
      expect(hint).toContain('2 symbols');
      expect(hint).toContain('sess-001');
      expect(hint).toContain("namespace='nemu_symbols'");
      expect(hint).toContain("key='abc123def4567890'");
    });
  });
});
