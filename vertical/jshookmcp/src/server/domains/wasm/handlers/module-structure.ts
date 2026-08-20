/**
 * wasm_inspect — pure-TS wasm binary structural inspector.
 *
 * Parses the module surface (type / import / function / table / memory /
 * global / export / start / element / code / data / custom sections) directly
 * from the binary, returning structured JSON. This is the wabt-independent
 * counterpart to `wasm_inspect_sections` (which shells out to `wasm-objdump`):
 * when wabt is unavailable (see `wasm_capabilities`) this is the only path to
 * the import/export/memory/table/type surface — table-stakes for any binary
 * reverse-engineering workflow.
 *
 * Honest boundary: STRUCTURE only. Code-body opcodes are NOT disassembled
 * (that is `wasm_disassemble` / wabt's job). Element/data/global-init segment
 * payloads are reported as counts; their full initializer decode is deferred.
 * Parsing is tolerant: a malformed section is recorded in `parseErrors` and
 * skipped, so a partially-corrupt or packed module still yields its surface.
 */

import {
  parseFunctionNames,
  parseWasmSections,
  readS64Leb128,
  readU32Leb128,
  type WasmFunctionName,
  type WasmSection,
} from './binary-reader';

export interface WasmValType {
  raw: number;
  name: string;
}

export interface WasmFuncType {
  form: number; // 0x60 = func
  params: WasmValType[];
  results: WasmValType[];
}

export interface WasmLimits {
  min: number;
  max?: number;
  shared: boolean;
}

export type WasmExternalKind =
  | 'function'
  | 'table'
  | 'memory'
  | 'global'
  | 'tag'
  | `unknown-${number}`;

export interface WasmImport {
  module: string;
  field: string;
  kind: WasmExternalKind;
  typeIndex?: number; // function
  elementType?: WasmValType; // table
  limits?: WasmLimits; // table | memory
  valueType?: WasmValType; // global
  mutable?: boolean; // global
}

export interface WasmDeclaredFunction {
  /** Index in the combined function index space (imported funcs first). */
  index: number;
  typeIndex: number;
  /** Recovered from the custom "name" section when present. */
  name?: string;
}

export interface WasmTable {
  elementType: WasmValType;
  limits: WasmLimits;
}

export interface WasmMemory {
  limits: WasmLimits;
}

export interface WasmGlobal {
  valueType: WasmValType;
  mutable: boolean;
}

export interface WasmExport {
  name: string;
  kind: WasmExternalKind;
  index: number;
}

export interface WasmProducerEntry {
  name: string;
  version: string;
}

export interface WasmProducerField {
  name: string;
  values: WasmProducerEntry[];
}

export interface WasmTargetFeature {
  prefix: '+' | '-' | '=';
  name: string;
}

export interface WasmCustomSectionInfo {
  name: string;
  payloadBytes: number;
  functionNames?: WasmFunctionName[];
  producers?: WasmProducerField[];
  targetFeatures?: WasmTargetFeature[];
}

export interface WasmModuleStructure {
  version: number;
  sectionCount: number;
  types: WasmFuncType[];
  imports: WasmImport[];
  importedFunctionCount: number;
  declaredFunctions: WasmDeclaredFunction[];
  functionCountTotal: number;
  tables: WasmTable[];
  memories: WasmMemory[];
  globals: WasmGlobal[];
  exports: WasmExport[];
  startFunction?: number;
  elementSegments: number;
  codeSection: { functionCount: number; totalCodeBytes: number } | null;
  dataSegments: number;
  customSections: WasmCustomSectionInfo[];
  importCount: number;
  exportCount: number;
  parseErrors: string[];
  honestBoundary: string;
}

const VAL_TYPE_NAMES: Record<number, string> = {
  0x7f: 'i32',
  0x7e: 'i64',
  0x7d: 'f32',
  0x7c: 'f64',
  0x7b: 'v128',
  0x70: 'funcref',
  0x6f: 'externref',
};

export function decodeValType(byte: number): WasmValType {
  return { raw: byte, name: VAL_TYPE_NAMES[byte] ?? `valtype-0x${byte.toString(16)}` };
}

const KIND_NAMES: Record<number, WasmExternalKind> = {
  0x00: 'function',
  0x01: 'table',
  0x02: 'memory',
  0x03: 'global',
  0x04: 'tag',
};

function decodeKind(byte: number): WasmExternalKind {
  return KIND_NAMES[byte] ?? (`unknown-${byte}` as WasmExternalKind);
}

/** Read a length-prefixed UTF-8 name. Returns [name, nextOffset]. */
function readName(bytes: Buffer, pos: number): [string, number] {
  const [len, afterLen] = readU32Leb128(bytes, pos);
  const start = afterLen + len;
  return [bytes.subarray(afterLen, start).toString('utf8'), start];
}

/** Read a wasm limits entry. Returns [limits, nextOffset]. */
function readLimits(bytes: Buffer, pos: number): [WasmLimits, number] {
  const flag = bytes[pos++]!;
  const [min, afterMin] = readU32Leb128(bytes, pos);
  let max: number | undefined;
  let afterMax = afterMin;
  // bit 0 of the flag indicates a max is present (MVP flags: 0x00 / 0x01;
  // threads proposal adds 0x02 shared-no-max and 0x03 shared-with-max).
  if ((flag & 0x01) !== 0) {
    const [mx, after] = readU32Leb128(bytes, afterMin);
    max = mx;
    afterMax = after;
  }
  const shared = (flag & 0x02) !== 0;
  return [{ min, ...(max === undefined ? {} : { max }), shared }, afterMax];
}

/**
 * Skip a constant expression (global/element/data initializer). Const-expr
 * operands are flat — no nested blocks — and terminate at the 0x0b `end`
 * marker. We decode each leading opcode's operand width so a 0x0b byte inside
 * an f64 payload cannot prematurely terminate the scan. Returns nextOffset
 * positioned AFTER the 0x0b.
 */
function skipConstExpr(bytes: Buffer, pos: number): number {
  const len = bytes.length;
  let p = pos;
  while (p < len) {
    const op = bytes[p++]!;
    switch (op) {
      case 0x41: // i32.const  → sLEB32
        [, p] = readS64Leb128(bytes, p);
        break;
      case 0x42: // i64.const  → sLEB64
        [, p] = readS64Leb128(bytes, p);
        break;
      case 0x43: // f32.const  → 4 bytes
        p += 4;
        break;
      case 0x44: // f64.const  → 8 bytes
        p += 8;
        break;
      case 0x23: // global.get → uLEB
      case 0xd2: // ref.func   → uLEB
        [, p] = readU32Leb128(bytes, p);
        break;
      case 0xd0: // ref.null   → 1 type byte
        p += 1;
        break;
      case 0x0b: // end marker
        return p;
      default:
        // Unknown const-expr opcode — bail by scanning to the next 0x0b.
        // This is the tolerant fallback; recorded as a parse note upstream.
        throw new Error(`unknown const-expr opcode 0x${op.toString(16)}`);
    }
  }
  throw new Error('const-expr ran past end of section without 0x0b');
}

function parseTypesSection(bytes: Buffer, section: WasmSection): WasmFuncType[] {
  let p = section.bodyStart;
  const [count, afterCount] = readU32Leb128(bytes, p);
  p = afterCount;
  const types: WasmFuncType[] = [];
  for (let i = 0; i < count && p < section.bodyEnd; i++) {
    const form = bytes[p++]!;
    if (form !== 0x60) {
      // Non-MVP form (e.g. rec-group / GC). We cannot bound its extent without
      // a full proposal parser, so stop here and let the caller record a note.
      throw new Error(`unsupported type form 0x${form.toString(16)} (only 0x60 func)`);
    }
    const [paramCount, afterParamCount] = readU32Leb128(bytes, p);
    p = afterParamCount;
    const params: WasmValType[] = [];
    for (let j = 0; j < paramCount && p < section.bodyEnd; j++) {
      params.push(decodeValType(bytes[p++]!));
    }
    const [resultCount, afterResultCount] = readU32Leb128(bytes, p);
    p = afterResultCount;
    const results: WasmValType[] = [];
    for (let j = 0; j < resultCount && p < section.bodyEnd; j++) {
      results.push(decodeValType(bytes[p++]!));
    }
    types.push({ form, params, results });
  }
  return types;
}

function parseImportSection(
  bytes: Buffer,
  section: WasmSection,
): {
  imports: WasmImport[];
  importedFunctionCount: number;
} {
  let p = section.bodyStart;
  const [count, afterCount] = readU32Leb128(bytes, p);
  p = afterCount;
  const imports: WasmImport[] = [];
  let funcCount = 0;
  for (let i = 0; i < count && p < section.bodyEnd; i++) {
    const [module, afterModule] = readName(bytes, p);
    p = afterModule;
    const [field, afterField] = readName(bytes, p);
    p = afterField;
    const kindByte = bytes[p++]!;
    const kind = decodeKind(kindByte);
    const entry: WasmImport = { module, field, kind };
    if (kindByte === 0x00) {
      const [typeIdx, afterType] = readU32Leb128(bytes, p);
      entry.typeIndex = typeIdx;
      p = afterType;
      funcCount++;
    } else if (kindByte === 0x01) {
      entry.elementType = decodeValType(bytes[p++]!);
      const [limits, afterLimits] = readLimits(bytes, p);
      entry.limits = limits;
      p = afterLimits;
    } else if (kindByte === 0x02) {
      const [limits, afterLimits] = readLimits(bytes, p);
      entry.limits = limits;
      p = afterLimits;
    } else if (kindByte === 0x03) {
      entry.valueType = decodeValType(bytes[p++]!);
      entry.mutable = bytes[p++] === 1;
      p = skipConstExpr(bytes, p);
    } else if (kindByte === 0x04) {
      // tag (exceptions proposal): attribute byte + type index
      p++; // attribute
      const [, afterType] = readU32Leb128(bytes, p);
      p = afterType;
    } else {
      // unknown import kind — cannot bound; stop importing further entries.
      throw new Error(`unknown import kind 0x${kindByte.toString(16)}`);
    }
    imports.push(entry);
  }
  return { imports, importedFunctionCount: funcCount };
}

function parseFunctionSection(
  bytes: Buffer,
  section: WasmSection,
  importedFunctionCount: number,
  functionNames: Map<number, string>,
): WasmDeclaredFunction[] {
  let p = section.bodyStart;
  const [count, afterCount] = readU32Leb128(bytes, p);
  p = afterCount;
  const funcs: WasmDeclaredFunction[] = [];
  for (let i = 0; i < count && p < section.bodyEnd; i++) {
    const [typeIdx, afterType] = readU32Leb128(bytes, p);
    p = afterType;
    const index = importedFunctionCount + i;
    const name = functionNames.get(index);
    funcs.push({ index, typeIndex: typeIdx, ...(name === undefined ? {} : { name }) });
  }
  return funcs;
}

function parseTableSection(bytes: Buffer, section: WasmSection): WasmTable[] {
  let p = section.bodyStart;
  const [count, afterCount] = readU32Leb128(bytes, p);
  p = afterCount;
  const tables: WasmTable[] = [];
  for (let i = 0; i < count && p < section.bodyEnd; i++) {
    const elem = decodeValType(bytes[p++]!);
    const [limits, afterLimits] = readLimits(bytes, p);
    p = afterLimits;
    tables.push({ elementType: elem, limits });
  }
  return tables;
}

function parseMemorySection(bytes: Buffer, section: WasmSection): WasmMemory[] {
  let p = section.bodyStart;
  const [count, afterCount] = readU32Leb128(bytes, p);
  p = afterCount;
  const memories: WasmMemory[] = [];
  for (let i = 0; i < count && p < section.bodyEnd; i++) {
    const [limits, afterLimits] = readLimits(bytes, p);
    p = afterLimits;
    memories.push({ limits });
  }
  return memories;
}

function parseGlobalSection(bytes: Buffer, section: WasmSection): WasmGlobal[] {
  let p = section.bodyStart;
  const [count, afterCount] = readU32Leb128(bytes, p);
  p = afterCount;
  const globals: WasmGlobal[] = [];
  for (let i = 0; i < count && p < section.bodyEnd; i++) {
    const vt = decodeValType(bytes[p++]!);
    const mutable = bytes[p++] === 1;
    p = skipConstExpr(bytes, p);
    globals.push({ valueType: vt, mutable });
  }
  return globals;
}

function parseExportSection(bytes: Buffer, section: WasmSection): WasmExport[] {
  let p = section.bodyStart;
  const [count, afterCount] = readU32Leb128(bytes, p);
  p = afterCount;
  const exports: WasmExport[] = [];
  for (let i = 0; i < count && p < section.bodyEnd; i++) {
    const [name, afterName] = readName(bytes, p);
    p = afterName;
    const kindByte = bytes[p++]!;
    const [idx, afterIdx] = readU32Leb128(bytes, p);
    p = afterIdx;
    exports.push({ name, kind: decodeKind(kindByte), index: idx });
  }
  return exports;
}

function parseStartSection(bytes: Buffer, section: WasmSection): number {
  const [idx] = readU32Leb128(bytes, section.bodyStart);
  return idx;
}

function parseCountOnly(bytes: Buffer, section: WasmSection): number {
  const [count] = readU32Leb128(bytes, section.bodyStart);
  return count;
}

function parseCodeSection(
  bytes: Buffer,
  section: WasmSection,
): { functionCount: number; totalCodeBytes: number } {
  let p = section.bodyStart;
  const [count, afterCount] = readU32Leb128(bytes, p);
  p = afterCount;
  let totalCodeBytes = 0;
  for (let i = 0; i < count && p < section.bodyEnd; i++) {
    const [size, afterSize] = readU32Leb128(bytes, p);
    p = afterSize;
    totalCodeBytes += size;
    p += size; // skip locals + body
  }
  return { functionCount: count, totalCodeBytes };
}

/** Parse a producers custom section (toolchain fingerprint). */
function parseProducersSection(
  bytes: Buffer,
  bodyStart: number,
  bodyEnd: number,
): WasmProducerField[] | undefined {
  try {
    let p = bodyStart;
    // skip the "producers" name string (length-prefixed)
    const [nl, afterNl] = readU32Leb128(bytes, p);
    p = afterNl + nl;
    const [fieldCount, afterFieldCount] = readU32Leb128(bytes, p);
    p = afterFieldCount;
    const fields: WasmProducerField[] = [];
    for (let i = 0; i < fieldCount && p < bodyEnd; i++) {
      const [fieldName, afterFieldName] = readName(bytes, p);
      p = afterFieldName;
      const [valueCount, afterValueCount] = readU32Leb128(bytes, p);
      p = afterValueCount;
      const values: WasmProducerEntry[] = [];
      for (let j = 0; j < valueCount && p < bodyEnd; j++) {
        const [pn, afterPn] = readName(bytes, p);
        p = afterPn;
        const [vn, afterVn] = readName(bytes, p);
        p = afterVn;
        values.push({ name: pn, version: vn });
      }
      fields.push({ name: fieldName, values });
    }
    return fields;
  } catch {
    return undefined;
  }
}

/** Parse a target_features custom section (enabled/disabled features). */
function parseTargetFeaturesSection(
  bytes: Buffer,
  bodyStart: number,
  bodyEnd: number,
): WasmTargetFeature[] | undefined {
  try {
    let p = bodyStart;
    const [nl, afterNl] = readU32Leb128(bytes, p);
    p = afterNl + nl; // skip the "target_features" name string
    const [count, afterCount] = readU32Leb128(bytes, p);
    p = afterCount;
    const features: WasmTargetFeature[] = [];
    for (let i = 0; i < count && p < bodyEnd; i++) {
      const prefixByte = bytes[p++]!;
      const prefix =
        prefixByte === 0x2b ? '+' : prefixByte === 0x2d ? '-' : prefixByte === 0x3d ? '=' : '=';
      const [name, afterName] = readName(bytes, p);
      p = afterName;
      features.push({ prefix, name });
    }
    return features;
  } catch {
    return undefined;
  }
}

export interface InspectModuleStructureOptions {
  /** Cap the number of types/imports/exports/etc. arrays carry in full. */
  maxPerArray?: number;
}

export function inspectModuleStructure(
  bytes: Buffer,
  _opts: InspectModuleStructureOptions = {},
): WasmModuleStructure {
  const sections = parseWasmSections(bytes);
  const parseErrors: string[] = [];

  const version = bytes.readUInt32LE(4);

  // First pass: locate the custom:name section (if any) so declared functions
  // can be enriched with names in the function-section parse.
  let functionNames: WasmFunctionName[] = [];
  for (const s of sections) {
    if (s.name === 'custom:name') {
      functionNames = parseFunctionNames(bytes, s.bodyStart, s.bodyEnd);
      break;
    }
  }
  const nameMap = new Map<number, string>();
  for (const fn of functionNames) nameMap.set(fn.index, fn.name);

  let types: WasmFuncType[] = [];
  let imports: WasmImport[] = [];
  let importedFunctionCount = 0;
  let declaredFunctions: WasmDeclaredFunction[] = [];
  let tables: WasmTable[] = [];
  let memories: WasmMemory[] = [];
  let globals: WasmGlobal[] = [];
  let exports: WasmExport[] = [];
  let startFunction: number | undefined;
  let elementSegments = 0;
  let codeSection: { functionCount: number; totalCodeBytes: number } | null = null;
  let dataSegments = 0;
  const customSections: WasmCustomSectionInfo[] = [];

  for (const s of sections) {
    try {
      switch (s.id) {
        case 0: {
          // custom — strip the "custom:" prefix that parseWasmSections adds
          const customName = s.name.startsWith('custom:') ? s.name.slice('custom:'.length) : s.name;
          // payloadBytes = body after the length-prefixed name string (the
          // actual content, not counting the name overhead)
          let payloadAfterName = s.bodyEnd - s.bodyStart;
          try {
            const [nameLen, nameStart] = readU32Leb128(bytes, s.bodyStart);
            payloadAfterName = s.bodyEnd - (nameStart + nameLen);
          } catch {
            // leave the whole-body size if the name length is itself truncated
          }
          const info: WasmCustomSectionInfo = { name: customName, payloadBytes: payloadAfterName };
          if (customName === 'name') {
            info.functionNames = parseFunctionNames(bytes, s.bodyStart, s.bodyEnd);
          } else if (customName === 'producers') {
            const producers = parseProducersSection(bytes, s.bodyStart, s.bodyEnd);
            if (producers) info.producers = producers;
          } else if (customName === 'target_features') {
            const feats = parseTargetFeaturesSection(bytes, s.bodyStart, s.bodyEnd);
            if (feats) info.targetFeatures = feats;
          }
          customSections.push(info);
          break;
        }
        case 1:
          types = parseTypesSection(bytes, s);
          break;
        case 2: {
          const r = parseImportSection(bytes, s);
          imports = r.imports;
          importedFunctionCount = r.importedFunctionCount;
          break;
        }
        case 3:
          declaredFunctions = parseFunctionSection(bytes, s, importedFunctionCount, nameMap);
          break;
        case 4:
          tables = parseTableSection(bytes, s);
          break;
        case 5:
          memories = parseMemorySection(bytes, s);
          break;
        case 6:
          globals = parseGlobalSection(bytes, s);
          break;
        case 7:
          exports = parseExportSection(bytes, s);
          break;
        case 8:
          startFunction = parseStartSection(bytes, s);
          break;
        case 9:
          elementSegments = parseCountOnly(bytes, s);
          break;
        case 10:
          codeSection = parseCodeSection(bytes, s);
          break;
        case 11:
          dataSegments = parseCountOnly(bytes, s);
          break;
        default:
          break;
      }
    } catch (error) {
      parseErrors.push(`${s.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    version,
    sectionCount: sections.length,
    types,
    imports,
    importedFunctionCount,
    declaredFunctions,
    functionCountTotal: importedFunctionCount + declaredFunctions.length,
    tables,
    memories,
    globals,
    exports,
    ...(startFunction === undefined ? {} : { startFunction }),
    elementSegments,
    codeSection,
    dataSegments,
    customSections,
    importCount: imports.length,
    exportCount: exports.length,
    parseErrors,
    honestBoundary:
      'Structure only — no code-body disassembly (use wasm_disassemble / wabt). ' +
      'Element/data/global-init segments are reported as counts; full initializer ' +
      'decode is deferred. Custom sections beyond name/producers/target_features ' +
      'are reported as name + size only. Parsing is tolerant: malformed sections ' +
      'are recorded in parseErrors and skipped. This is the pure-TS, wabt-' +
      'independent counterpart to wasm_inspect_sections (wasm-objdump).',
  };
}
