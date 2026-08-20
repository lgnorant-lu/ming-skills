import { describe, expect, it } from 'vitest';

import {
  decodeValType,
  inspectModuleStructure,
} from '@server/domains/wasm/handlers/module-structure';

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** Encode an unsigned LEB128. */
function leb128(n: number): Buffer {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return Buffer.from(out);
}

/** Length-prefixed UTF-8 name. */
function nameStr(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([leb128(b.length), b]);
}

/** Build a wasm section: id + LEB(size) + body. */
function makeSection(id: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([id]), leb128(body.length), body]);
}

/** Build a custom section (id 0): name string + payload. */
function makeCustomSection(name: string, payload: Buffer): Buffer {
  return makeSection(0, Buffer.concat([nameStr(name), payload]));
}

/** Limits entry: flag + min [+ max]. */
function limits(flag: number, min: number, max?: number): Buffer {
  const parts: Buffer[] = [Buffer.from([flag]), leb128(min)];
  if (max !== undefined) parts.push(leb128(max));
  return Buffer.concat(parts);
}

/** Type section (id 1). */
function makeTypeSection(types: Array<{ params: number[]; results: number[] }>): Buffer {
  const entries: Buffer[] = [leb128(types.length)];
  for (const t of types) {
    entries.push(
      Buffer.concat([
        Buffer.from([0x60]),
        leb128(t.params.length),
        Buffer.from(t.params),
        leb128(t.results.length),
        Buffer.from(t.results),
      ]),
    );
  }
  return makeSection(1, Buffer.concat(entries));
}

interface ImportSpec {
  module: string;
  field: string;
  kind: 0x00 | 0x01 | 0x02 | 0x03;
  typeIndex?: number;
  elemType?: number;
  flag?: number;
  min?: number;
  max?: number;
  valueType?: number;
  mutable?: boolean;
}

/** Import section (id 2). */
function makeImportSection(imports: ImportSpec[]): Buffer {
  const entries: Buffer[] = [leb128(imports.length)];
  for (const imp of imports) {
    const parts: Buffer[] = [nameStr(imp.module), nameStr(imp.field), Buffer.from([imp.kind])];
    if (imp.kind === 0x00) {
      parts.push(leb128(imp.typeIndex ?? 0));
    } else if (imp.kind === 0x01) {
      parts.push(Buffer.from([imp.elemType ?? 0x70]), limits(imp.flag ?? 0, imp.min ?? 1, imp.max));
    } else if (imp.kind === 0x02) {
      parts.push(limits(imp.flag ?? 0, imp.min ?? 1, imp.max));
    } else if (imp.kind === 0x03) {
      parts.push(
        Buffer.from([imp.valueType ?? 0x7f, imp.mutable ? 1 : 0]),
        // i32.const 0 ; end
        Buffer.from([0x41, 0x00, 0x0b]),
      );
    }
    entries.push(Buffer.concat(parts));
  }
  return makeSection(2, Buffer.concat(entries));
}

/** Function section (id 3): type-index stream. */
function makeFunctionSection(typeIdxs: number[]): Buffer {
  const entries: Buffer[] = [leb128(typeIdxs.length)];
  for (const idx of typeIdxs) entries.push(leb128(idx));
  return makeSection(3, Buffer.concat(entries));
}

/** Memory section (id 5). */
function makeMemorySection(mems: Array<{ flag: number; min: number; max?: number }>): Buffer {
  const entries: Buffer[] = [leb128(mems.length)];
  for (const m of mems) entries.push(limits(m.flag, m.min, m.max));
  return makeSection(5, Buffer.concat(entries));
}

/** Table section (id 4). */
function makeTableSection(
  tables: Array<{ elemType: number; flag: number; min: number; max?: number }>,
): Buffer {
  const entries: Buffer[] = [leb128(tables.length)];
  for (const t of tables) {
    entries.push(Buffer.concat([Buffer.from([t.elemType]), limits(t.flag, t.min, t.max)]));
  }
  return makeSection(4, Buffer.concat(entries));
}

/** Global section (id 6). */
function makeGlobalSection(globals: Array<{ valueType: number; mutable: boolean }>): Buffer {
  const entries: Buffer[] = [leb128(globals.length)];
  for (const g of globals) {
    entries.push(
      Buffer.concat([
        Buffer.from([g.valueType, g.mutable ? 1 : 0]),
        Buffer.from([0x41, 0x00, 0x0b]), // i32.const 0 ; end
      ]),
    );
  }
  return makeSection(6, Buffer.concat(entries));
}

/** Export section (id 7). */
function makeExportSection(exports: Array<{ name: string; kind: number; index: number }>): Buffer {
  const entries: Buffer[] = [leb128(exports.length)];
  for (const e of exports) {
    entries.push(Buffer.concat([nameStr(e.name), Buffer.from([e.kind]), leb128(e.index)]));
  }
  return makeSection(7, Buffer.concat(entries));
}

/** Start section (id 8): single function index. */
function makeStartSection(funcIdx: number): Buffer {
  return makeSection(8, leb128(funcIdx));
}

/** Code section (id 10): one minimal body per function. */
function makeCodeSection(funcCount: number): Buffer {
  const entries: Buffer[] = [leb128(funcCount)];
  for (let i = 0; i < funcCount; i++) {
    // body = 0 local-decls + end
    const body = Buffer.from([0x00, 0x0b]);
    entries.push(Buffer.concat([leb128(body.length), body]));
  }
  return makeSection(10, Buffer.concat(entries));
}

/** Element section (id 9): count only (segment details omitted). */
function makeElementCountSection(count: number): Buffer {
  return makeSection(9, leb128(count));
}

/** Data section (id 11): count only. */
function makeDataCountSection(count: number): Buffer {
  return makeSection(11, leb128(count));
}

/** custom:name section with a function-name subsection. */
function makeNameSection(funcs: Array<{ index: number; name: string }>): Buffer {
  const subParts: Buffer[] = [leb128(funcs.length)];
  for (const f of funcs) {
    subParts.push(leb128(f.index), nameStr(f.name));
  }
  const subPayload = Buffer.concat(subParts);
  const subsection = Buffer.concat([Buffer.from([0x02]), leb128(subPayload.length), subPayload]);
  return makeCustomSection('name', subsection);
}

/** custom:producers section. */
function makeProducersSection(
  fields: Array<{ name: string; values: Array<{ name: string; version: string }> }>,
): Buffer {
  const parts: Buffer[] = [leb128(fields.length)];
  for (const f of fields) {
    parts.push(nameStr(f.name));
    parts.push(leb128(f.values.length));
    for (const v of f.values) {
      parts.push(nameStr(v.name), nameStr(v.version));
    }
  }
  return makeCustomSection('producers', Buffer.concat(parts));
}

/** custom:target_features section. */
function makeTargetFeaturesSection(features: Array<{ prefix: number; name: string }>): Buffer {
  const parts: Buffer[] = [leb128(features.length)];
  for (const f of features) {
    parts.push(Buffer.from([f.prefix]), nameStr(f.name));
  }
  return makeCustomSection('target_features', Buffer.concat(parts));
}

describe('wasm_inspect — inspectModuleStructure', () => {
  it('parses an empty (header-only) module', () => {
    const r = inspectModuleStructure(WASM_HEADER);
    expect(r.version).toBe(1);
    expect(r.sectionCount).toBe(0);
    expect(r.types).toEqual([]);
    expect(r.imports).toEqual([]);
    expect(r.exports).toEqual([]);
    expect(r.functionCountTotal).toBe(0);
    expect(r.parseErrors).toEqual([]);
  });

  it('rejects non-wasm input', () => {
    expect(() => inspectModuleStructure(Buffer.from('not a wasm binary'))).toThrow(/magic header/);
  });

  it('parses the type section (function signatures)', () => {
    const bytes = Buffer.concat([
      WASM_HEADER,
      makeTypeSection([
        { params: [0x7f], results: [0x7f] }, // (i32) -> i32
        { params: [0x7f, 0x7e], results: [] }, // (i32 i64) -> ()
      ]),
    ]);
    const r = inspectModuleStructure(bytes);
    expect(r.types).toHaveLength(2);
    expect(r.types[0]).toEqual({
      form: 0x60,
      params: [{ raw: 0x7f, name: 'i32' }],
      results: [{ raw: 0x7f, name: 'i32' }],
    });
    expect(r.types[1]!.params.map((p) => p.name)).toEqual(['i32', 'i64']);
    expect(r.types[1]!.results).toEqual([]);
  });

  it('parses imports of every kind and counts imported functions', () => {
    const bytes = Buffer.concat([
      WASM_HEADER,
      makeImportSection([
        { module: 'env', field: 'log', kind: 0x00, typeIndex: 0 },
        { module: 'env', field: 'mem', kind: 0x02, flag: 0x01, min: 1, max: 16 },
        { module: 'env', field: 'tbl', kind: 0x01, elemType: 0x70, flag: 0x00, min: 4 },
        { module: 'env', field: 'g', kind: 0x03, valueType: 0x7f, mutable: true },
      ]),
    ]);
    const r = inspectModuleStructure(bytes);
    expect(r.importCount).toBe(4);
    expect(r.importedFunctionCount).toBe(1);
    const log = r.imports[0]!;
    expect(log).toMatchObject({ module: 'env', field: 'log', kind: 'function', typeIndex: 0 });
    const mem = r.imports[1]!;
    expect(mem.kind).toBe('memory');
    expect(mem.limits).toEqual({ min: 1, max: 16, shared: false });
    const tbl = r.imports[2]!;
    expect(tbl.kind).toBe('table');
    expect(tbl.elementType).toEqual({ raw: 0x70, name: 'funcref' });
    expect(tbl.limits).toEqual({ min: 4, shared: false });
    const g = r.imports[3]!;
    expect(g.kind).toBe('global');
    expect(g.valueType).toEqual({ raw: 0x7f, name: 'i32' });
    expect(g.mutable).toBe(true);
  });

  it('parses shared limits (threads proposal flag 0x03)', () => {
    const bytes = Buffer.concat([WASM_HEADER, makeMemorySection([{ flag: 0x03, min: 1, max: 8 }])]);
    const r = inspectModuleStructure(bytes);
    expect(r.memories[0]!.limits).toEqual({ min: 1, max: 8, shared: true });
  });

  it('maps declared functions into the combined index space with name recovery', () => {
    // 1 imported function (index 0) + 2 declared (indices 1, 2)
    const bytes = Buffer.concat([
      WASM_HEADER,
      makeImportSection([{ module: 'env', field: 'f0', kind: 0x00, typeIndex: 0 }]),
      makeFunctionSection([0, 0]),
      makeNameSection([
        { index: 1, name: 'encrypt' },
        { index: 2, name: 'decrypt' },
      ]),
    ]);
    const r = inspectModuleStructure(bytes);
    expect(r.importedFunctionCount).toBe(1);
    expect(r.declaredFunctions).toEqual([
      { index: 1, typeIndex: 0, name: 'encrypt' },
      { index: 2, typeIndex: 0, name: 'decrypt' },
    ]);
    expect(r.functionCountTotal).toBe(3);
  });

  it('parses tables, globals, exports and start', () => {
    const bytes = Buffer.concat([
      WASM_HEADER,
      makeTableSection([{ elemType: 0x70, flag: 0x01, min: 0, max: 10 }]),
      makeGlobalSection([
        { valueType: 0x7f, mutable: false },
        { valueType: 0x7e, mutable: true },
      ]),
      makeExportSection([
        { name: 'memory', kind: 0x02, index: 0 },
        { name: 'run', kind: 0x00, index: 0 },
      ]),
      makeStartSection(0),
    ]);
    const r = inspectModuleStructure(bytes);
    expect(r.tables[0]).toEqual({
      elementType: { raw: 0x70, name: 'funcref' },
      limits: { min: 0, max: 10, shared: false },
    });
    expect(r.globals.map((g) => [g.valueType.name, g.mutable])).toEqual([
      ['i32', false],
      ['i64', true],
    ]);
    expect(r.exports).toEqual([
      { name: 'memory', kind: 'memory', index: 0 },
      { name: 'run', kind: 'function', index: 0 },
    ]);
    expect(r.startFunction).toBe(0);
  });

  it('parses code section function count + total bytes, and element/data counts', () => {
    const bytes = Buffer.concat([
      WASM_HEADER,
      makeElementCountSection(2),
      makeCodeSection(3),
      makeDataCountSection(1),
    ]);
    const r = inspectModuleStructure(bytes);
    expect(r.codeSection).toEqual({ functionCount: 3, totalCodeBytes: 6 }); // 3 × (2-byte body)
    expect(r.elementSegments).toBe(2);
    expect(r.dataSegments).toBe(1);
  });

  it('parses producers and target_features custom sections for fingerprinting', () => {
    const bytes = Buffer.concat([
      WASM_HEADER,
      makeProducersSection([
        {
          name: 'language',
          values: [{ name: 'C++', version: '1.2.3' }],
        },
        {
          name: 'processed-by',
          values: [{ name: 'emscripten', version: '3.1.0' }],
        },
      ]),
      makeTargetFeaturesSection([
        { prefix: 0x2b, name: 'simd' }, // '+'
        { prefix: 0x2d, name: 'threads' }, // '-'
      ]),
    ]);
    const r = inspectModuleStructure(bytes);
    const producers = r.customSections.find((c) => c.name === 'producers');
    expect(producers?.producers).toEqual([
      { name: 'language', values: [{ name: 'C++', version: '1.2.3' }] },
      {
        name: 'processed-by',
        values: [{ name: 'emscripten', version: '3.1.0' }],
      },
    ]);
    const feats = r.customSections.find((c) => c.name === 'target_features');
    expect(feats?.targetFeatures).toEqual([
      { prefix: '+', name: 'simd' },
      { prefix: '-', name: 'threads' },
    ]);
  });

  it('records unknown custom sections as name + size (no content parse)', () => {
    const bytes = Buffer.concat([
      WASM_HEADER,
      makeCustomSection('dylink', Buffer.from([0x01, 0x02, 0x03, 0x04])),
    ]);
    const r = inspectModuleStructure(bytes);
    const dylink = r.customSections.find((c) => c.name === 'dylink');
    expect(dylink).toBeDefined();
    expect(dylink!.payloadBytes).toBe(4);
    expect(dylink!.producers).toBeUndefined();
    expect(dylink!.functionNames).toBeUndefined();
  });

  it('tolerates a malformed type section (records parseErrors, keeps other sections)', () => {
    // Well-formed memory section + a type section declaring 1 entry whose form
    // byte is not 0x60 — parseTypesSection throws and the error is recorded.
    const truncatedTypeBody = Buffer.concat([leb128(1), Buffer.from([0x99])]); // count=1, bad form
    const bytes = Buffer.concat([
      WASM_HEADER,
      makeSection(1, truncatedTypeBody),
      makeMemorySection([{ flag: 0x00, min: 1 }]),
    ]);
    const r = inspectModuleStructure(bytes);
    expect(r.types).toEqual([]); // type parse threw → empty
    expect(r.parseErrors.length).toBeGreaterThan(0);
    expect(r.parseErrors.some((e) => e.startsWith('type:'))).toBe(true);
    // the memory section still parsed
    expect(r.memories[0]!.limits).toEqual({ min: 1, shared: false });
  });

  it('exposes the honest boundary text in the result', () => {
    const r = inspectModuleStructure(WASM_HEADER);
    expect(r.honestBoundary).toContain('Structure only');
    expect(r.honestBoundary).toContain('wasm_disassemble');
  });

  it('decodeValType names every MVP value type', () => {
    expect(decodeValType(0x7f).name).toBe('i32');
    expect(decodeValType(0x7e).name).toBe('i64');
    expect(decodeValType(0x7d).name).toBe('f32');
    expect(decodeValType(0x7c).name).toBe('f64');
    expect(decodeValType(0x70).name).toBe('funcref');
    expect(decodeValType(0x6f).name).toBe('externref');
    expect(decodeValType(0xab).name).toBe('valtype-0xab');
  });
});
