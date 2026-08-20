import { describe, expect, it } from 'vitest';

import {
  classifyString,
  extractWasmStrings,
} from '@server/domains/wasm/handlers/string-extract-handlers';

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

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

function makeSection(id: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([id]), leb128(body.length), body]);
}

function makeNameSection(funcs: Array<{ index: number; name: string }>): Buffer {
  const subParts: Buffer[] = [leb128(funcs.length)];
  for (const f of funcs) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    subParts.push(leb128(f.index), leb128(nameBuf.length), nameBuf);
  }
  const subPayload = Buffer.concat(subParts);
  const subsection = Buffer.concat([Buffer.from([0x02]), leb128(subPayload.length), subPayload]);
  const nameStr = Buffer.from('name', 'utf8');
  const body = Buffer.concat([leb128(nameStr.length), nameStr, subsection]);
  return makeSection(0x00, body);
}

function buildFixture(
  dataContent: string,
  funcs: Array<{ index: number; name: string }> = [],
): Buffer {
  const parts: Buffer[] = [WASM_HEADER, makeSection(0x0b, Buffer.from(dataContent, 'latin1'))];
  if (funcs.length > 0) parts.push(makeNameSection(funcs));
  return Buffer.concat(parts);
}

describe('wasm_string_extract', () => {
  it('extracts strings grouped by section and recovers function names', () => {
    const bytes = buildFixture(
      'https://example.com/api\x00secret_key_123\x00d41d8cd98f00b204e9800998ecf8427e',
      [
        { index: 0, name: 'encrypt' },
        { index: 1, name: 'decrypt' },
      ],
    );
    const result = extractWasmStrings(bytes);

    expect(result.functionNames).toEqual([
      { index: 0, name: 'encrypt' },
      { index: 1, name: 'decrypt' },
    ]);
    expect(result.bySection['data']).toBe(3);
    const values = result.strings.map((s) => s.value);
    expect(values).toContain('https://example.com/api');
    expect(values).toContain('secret_key_123');
    expect(result.classified['url']?.map((s) => s.value)).toContain('https://example.com/api');
    expect(result.classified['hex-hash']?.map((s) => s.value)).toContain(
      'd41d8cd98f00b204e9800998ecf8427e',
    );
  });

  it('rejects non-wasm input', () => {
    expect(() => extractWasmStrings(Buffer.from('not a wasm binary'))).toThrow(/magic header/);
  });

  it('respects minLength', () => {
    const bytes = buildFixture('ab\x00abcdef');
    expect(extractWasmStrings(bytes, { minLength: 4 }).strings.map((s) => s.value)).toEqual([
      'abcdef',
    ]);
    expect(extractWasmStrings(bytes, { minLength: 1 }).strings.map((s) => s.value)).toContain('ab');
  });

  it('caps output at maxStrings and flags truncation', () => {
    const bytes = buildFixture('one\x00two\x00three\x00four');
    const result = extractWasmStrings(bytes, { minLength: 1, maxStrings: 2 });
    expect(result.returnedStrings).toBe(2);
    expect(result.totalStrings).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it('classifyString covers url/ip/email/hex-hash/file-path', () => {
    expect(classifyString('https://a.b/c')).toContain('url');
    expect(classifyString('10.0.0.1')).toContain('ip');
    expect(classifyString('user@example.com')).toContain('email');
    expect(classifyString('a'.repeat(40))).toContain('hex-hash');
    expect(classifyString('config.json')).toContain('file-path');
  });

  it('parses an empty (header-only) wasm module', () => {
    const result = extractWasmStrings(WASM_HEADER);
    expect(result.sectionCount).toBe(0);
    expect(result.totalStrings).toBe(0);
    expect(result.strings).toEqual([]);
  });

  it('tolerates a malformed name section (returns no names, still extracts strings)', () => {
    // name section with a truncated subsection payload
    const badNameBody = Buffer.concat([
      leb128(4),
      Buffer.from('name'),
      Buffer.from([0x02, 0x09, 0xff, 0xff]), // subsection size 9 but only 2 bytes follow
    ]);
    const bytes = Buffer.concat([WASM_HEADER, makeSection(0x00, badNameBody)]);
    const result = extractWasmStrings(bytes);
    expect(result.functionNames).toEqual([]);
  });
});
