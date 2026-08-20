/**
 * NativeEmulatorHandlers — MCP handler behaviour over the emulator session pool.
 *
 * Covers the happy path (create → load → call → JNI mock callback → byte
 * round-trip → trace → destroy), session-isolation, and the error paths
 * (unknown session, missing args, bad handle). A real assembler-verified .so is
 * written to a temp file because handlers read libraries by filesystem path.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers.impl';
import { SessionManager } from '@modules/native-emulator/SessionManager';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const ET_DYN = 3;
const SHT_DYNSYM = 11;
const SHT_STRTAB = 3;
const STT_FUNC = 2;
const STB_GLOBAL = 1;

interface SymbolSpec {
  name: string;
  codeOffset: number;
}

/** Assemble a .so with a code segment and named function exports. */
function buildSo(code: number[], symbols: SymbolSpec[], segVaddr = 0x1000): Uint8Array {
  const EHDR = 64;
  const PHDR = 56;
  const SHDR = 64;
  const SYM = 24;
  let dynstrStr = '\0';
  const nameOffsets = new Map<string, number>();
  for (const s of symbols) {
    nameOffsets.set(s.name, dynstrStr.length);
    dynstrStr += s.name + '\0';
  }
  const dynstr = Uint8Array.from([...dynstrStr].map((c) => c.charCodeAt(0)));
  const dynsym = new Uint8Array(SYM * (symbols.length + 1));
  {
    const dv = new DataView(dynsym.buffer);
    symbols.forEach((s, i) => {
      const base = SYM * (i + 1);
      dv.setUint32(base + 0x00, nameOffsets.get(s.name)!, true);
      dv.setUint8(base + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
      dv.setUint16(base + 0x06, 1, true);
      dv.setBigUint64(base + 0x08, BigInt(segVaddr + s.codeOffset), true);
    });
  }
  const segOffset = EHDR + PHDR;
  const dynstrOffset = segOffset + code.length;
  const dynsymOffset = dynstrOffset + dynstr.length;
  const shoff = dynsymOffset + dynsym.length;
  const shnum = 3;
  const buf = new ArrayBuffer(shoff + SHDR * shnum);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2);
  dv.setUint8(5, 1);
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setBigUint64(0x18, BigInt(segVaddr), true);
  dv.setBigUint64(0x20, BigInt(EHDR), true);
  dv.setBigUint64(0x28, BigInt(shoff), true);
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, 1, true);
  dv.setUint16(0x3a, SHDR, true);
  dv.setUint16(0x3c, shnum, true);
  const p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true);
  dv.setUint32(p + 0x04, 0b101, true);
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true);
  dv.setBigUint64(p + 0x10, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x20, BigInt(code.length), true);
  dv.setBigUint64(p + 0x28, BigInt(code.length), true);
  dv.setBigUint64(p + 0x30, 0x10000n, true);
  u8.set(code, segOffset);
  u8.set(dynstr, dynstrOffset);
  u8.set(dynsym, dynsymOffset);
  const writeShdr = (
    idx: number,
    shType: number,
    shOffset: number,
    shSize: number,
    shLink: number,
    shEntsize: number,
  ): void => {
    const s = shoff + idx * SHDR;
    dv.setUint32(s + 0x04, shType, true);
    dv.setBigUint64(s + 0x18, BigInt(shOffset), true);
    dv.setBigUint64(s + 0x20, BigInt(shSize), true);
    dv.setUint32(s + 0x28, shLink, true);
    dv.setBigUint64(s + 0x38, BigInt(shEntsize), true);
  };
  writeShdr(0, 0, 0, 0, 0, 0);
  writeShdr(1, SHT_DYNSYM, dynsymOffset, dynsym.length, 2, SYM);
  writeShdr(2, SHT_STRTAB, dynstrOffset, dynstr.length, 0, 0);
  return u8;
}

/** Parse the JSON payload out of an MCP text response. */
function payload(res: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = res.content.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

let tmpDir: string;
let soPath: string;
let nullCallSoPath: string;
// add_two: add x0, x0, x1 ; ret
const ADD_TWO = [0x00, 0x00, 0x01, 0x8b, 0xc0, 0x03, 0x5f, 0xd6];
// call_null: movz x8,#0 ; blr x8
const CALL_NULL = [0x08, 0x00, 0x80, 0xd2, 0x00, 0x01, 0x3f, 0xd6];

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'nemu-handlers-'));
  soPath = join(tmpDir, 'libadd.so');
  nullCallSoPath = join(tmpDir, 'lib-null-call.so');
  await writeFile(soPath, buildSo(ADD_TWO, [{ name: 'add_two', codeOffset: 0 }]));
  await writeFile(nullCallSoPath, buildSo(CALL_NULL, [{ name: 'call_null', codeOffset: 0 }]));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('NativeEmulatorHandlers — happy path', () => {
  let handlers: NativeEmulatorHandlers;

  afterEach(() => handlers.dispose());

  async function freshSession(): Promise<string> {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const created = payload(await handlers.handleCreateSession({ installSyscalls: false }));
    return created.sessionId as string;
  }

  it('reports capabilities without needing a session', async () => {
    handlers = new NativeEmulatorHandlers();
    const data = payload(await handlers.handleCapabilities({}));
    expect(data.success).toBe(true);
    expect(data.backend).toBe('self-built-arm64');
    expect(data.available).toBe(true);
  });

  it('disassembles a single instruction without creating a session', async () => {
    handlers = new NativeEmulatorHandlers();
    const data = payload(
      await handlers.handleDisassemble({
        architecture: 'x64',
        opcode: '62 f1 74 48 58 c2',
        pc: '0x1000',
      }),
    );
    expect(data.success).toBe(true);
    expect(data.normalizedArchitecture).toBe('x64');
    expect(String(data.asm)).toContain('vaddps');
    expect(String(data.asm)).toContain('zmm');
  });

  it('advertises the post-Phase-F feature set and an honest ISA boundary', async () => {
    handlers = new NativeEmulatorHandlers();
    const data = payload(await handlers.handleCapabilities({}));
    const features = data.features as string[];
    // Phase 2-5 capabilities are surfaced for an AI to discover.
    expect(features).toContain('elf-relocations');
    expect(features).toContain('elf-import-inspection');
    // DT_INIT_ARRAY constructors run after relocation (a real .so with C++ static
    // constructors needs this to initialize its globals before its API is called).
    expect(features).toContain('init-array-constructors');
    expect(features).toContain('auto-wire-bionic-libc');
    // Bionic stdio VFS lets file-existence probes be evaluated.
    expect(features).toContain('bionic-stdio-vfs');
    expect(features).toContain('raw-guest-memory');
    // JNI object-array iteration (GetArrayLength on String[]) drives native loops.
    expect(features).toContain('jni-object-array-iteration');
    expect(features).toContain('java-mock-field');
    expect(features).toContain('exclusive-load-store');
    expect(features).toContain('system-register-read');
    // Memory barriers (DMB/DSB/ISB) are no-ops in the single-threaded interpreter.
    expect(features).toContain('memory-barriers');
    // Phase C/D crypto extension is implemented (bit-exact vs FIPS vectors).
    expect(features).toContain('aes-crypto');
    expect(features).toContain('sha256-crypto');
    expect(features).toContain('sha1-crypto');
    expect(features).toContain('pmull-ghash');
    // Phase E scalar IEEE-754 floating-point is implemented.
    expect(features).toContain('scalar-fp');
    // Phase F NEON integer-lane SIMD is implemented.
    expect(features).toContain('neon-integer-simd');
    // Contiguous LD1/ST1 of multiple registers (NEON kernels stream rows with these).
    expect(features).toContain('simd-ld1-st1-multi');
    // NULL indirect-call detection: a call through an uninitialised pointer throws
    // rather than masquerading as a clean return (the failure mode that hid STUR).
    expect(features).toContain('null-indirect-call-detection');
    expect(data.isa).toBe('aarch64-integer+neon+crypto+fp16');
    const simd = data.simd as { supported: string[]; unsupported: string[] };
    expect(simd.supported).toEqual(
      expect.arrayContaining([
        'contiguous-ld1-st1',
        'aes-sha-pmull',
        'scalar-fp',
        'ld2-ld3-ld4-deinterleaving',
        'long-widening-neon',
        'saturating-neon',
        'neon-ins-general',
        'neon-bit-bif',
        'neon-pmul-vector',
        'vector-fmov-immediate',
        'fp16',
      ]),
    );
    // E4 finale: all previously-declared gaps are now implemented + bit-exact
    // verified, so the unsupported list is empty.
    expect(simd.unsupported).toEqual([]);
    expect(String(data.note)).toMatch(/NEON/);
    expect(String(data.note)).toMatch(/saturating|widening/);
    // The NULL indirect-call guard is advertised in the note for AI/agent callers.
    expect(String(data.note)).toMatch(/NULL indirect call/i);
  });

  it('creates a session and lists it', async () => {
    const id = await freshSession();
    expect(typeof id).toBe('string');
    const list = payload(await handlers.handleListSessions({}));
    expect(list.count).toBe(1);
  });

  it('reports session info without executing native code', async () => {
    const sessionId = await freshSession();
    const beforeLoad = payload(await handlers.handleSessionInfo({ sessionId }));
    expect(beforeLoad.success).toBe(true);
    expect(beforeLoad.sessionId).toBe(sessionId);
    expect(beforeLoad.symbols).toEqual([]);
    expect(beforeLoad.symbolCount).toBe(0);
    expect(beforeLoad.diagnostics).toEqual({
      unresolvedImports: [],
      constructorFaults: [],
    });

    await handlers.handleLoadLibrary({ sessionId, soPath });
    const afterLoad = payload(await handlers.handleSessionInfo({ sessionId }));
    expect(afterLoad.symbols).toEqual(['add_two']);
    expect(afterLoad.symbolCount).toBe(1);
    expect(afterLoad.activeSessions).toBe(1);
    expect(typeof afterLoad.createdAt).toBe('number');
    expect(typeof afterLoad.lastUsedAt).toBe('number');
    expect(afterLoad.diagnostics).toEqual({
      unresolvedImports: [],
      constructorFaults: [],
    });
  });

  it('loads a .so by path and lists its symbols', async () => {
    const sessionId = await freshSession();
    const loaded = payload(await handlers.handleLoadLibrary({ sessionId, soPath }));
    expect(loaded.success).toBe(true);
    expect(loaded.symbols).toEqual(['add_two']);
    expect(loaded.unresolvedImports).toEqual([]);
    expect(loaded.constructorFaults).toEqual([]);
    const syms = payload(await handlers.handleListSymbols({ sessionId }));
    expect(syms.symbols).toEqual(['add_two']);
  });

  it('calls an exported symbol with integer args', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleCallSymbol({ sessionId, symbol: 'add_two', args: [40, 2] }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(42);
  });

  it('round-trips a jbyteArray through new/read byte array', async () => {
    const sessionId = await freshSession();
    const data = Buffer.from([1, 2, 3, 4]).toString('base64');
    const created = payload(await handlers.handleNewByteArray({ sessionId, dataBase64: data }));
    const handle = created.handle as number;
    const read = payload(await handlers.handleReadByteArray({ sessionId, handle }));
    expect(read.dataBase64).toBe(data);
    expect(read.length).toBe(4);
  });

  it('allocates, reads, and writes raw guest memory through MCP handlers', async () => {
    const sessionId = await freshSession();
    const initial = Buffer.from([0x41, 0x42, 0x43]).toString('base64');
    const allocated = payload(
      await handlers.handleAllocMemory({ sessionId, size: 3, fillBytes: initial }),
    );
    const address = allocated.address as number;
    expect(address).toBeGreaterThan(0);

    const firstRead = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 3, includeDataBase64: true }),
    );
    expect(firstRead.dataBase64).toBe(initial);

    const patch = Buffer.from([0x78, 0x79]).toString('base64');
    const written = payload(
      await handlers.handleWriteMemory({ sessionId, address: address + 1, dataBase64: patch }),
    );
    expect(written.bytesWritten).toBe(2);

    const secondRead = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 3, includeDataBase64: true }),
    );
    expect(secondRead.dataBase64).toBe(Buffer.from([0x41, 0x78, 0x79]).toString('base64'));
  });

  it('bounds raw guest memory allocation, reads, and writes', async () => {
    const sessionId = await freshSession();
    const tooLargeAlloc = payload(
      await handlers.handleAllocMemory({ sessionId, size: 8, maxBytes: 4 }),
    );
    expect(tooLargeAlloc.success).toBe(false);
    expect(tooLargeAlloc.error).toContain('exceeds');

    const allocated = payload(await handlers.handleAllocMemory({ sessionId, size: 4 }));
    const address = allocated.address as number;
    const tooLargeRead = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 4, maxBytes: 2 }),
    );
    expect(tooLargeRead.success).toBe(false);
    expect(tooLargeRead.error).toContain('exceeds');

    const tooLargeWrite = payload(
      await handlers.handleWriteMemory({
        sessionId,
        address,
        dataBase64: Buffer.from([1, 2, 3]).toString('base64'),
        maxBytes: 2,
      }),
    );
    expect(tooLargeWrite.success).toBe(false);
    expect(tooLargeWrite.error).toContain('exceeds');
  });

  it('omits full raw memory base64 unless explicitly requested', async () => {
    const sessionId = await freshSession();
    const allocated = payload(
      await handlers.handleAllocMemory({
        sessionId,
        size: 3,
        fillBytes: Buffer.from([0x41, 0x42, 0x43]).toString('base64'),
      }),
    );
    const address = allocated.address as number;

    const preview = payload(await handlers.handleReadMemory({ sessionId, address, length: 3 }));
    expect(preview.dataBase64).toBeUndefined();
    expect(preview.dataBase64Omitted).toBe(true);
    expect(preview.previewBase64).toBe(Buffer.from([0x41, 0x42, 0x43]).toString('base64'));

    const full = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 3, includeDataBase64: true }),
    );
    expect(full.dataBase64).toBe(Buffer.from([0x41, 0x42, 0x43]).toString('base64'));
  });

  it('registers a declarative Java mock (no code eval)', async () => {
    const sessionId = await freshSession();
    const res = payload(
      await handlers.handleSetupJavaMock({
        sessionId,
        className: 'com/app/Config',
        methodName: 'getMagic',
        signature: '()I',
        returnInt: 42,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.returns).toBe('int');
  });

  it('rejects Java mocks with multiple return value kinds', async () => {
    const sessionId = await freshSession();
    const res = payload(
      await handlers.handleSetupJavaMock({
        sessionId,
        className: 'com/app/Config',
        methodName: 'getMagic',
        signature: '()I',
        returnInt: 42,
        returnString: 'forty-two',
      }),
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('returnInt, returnString, and returnBytes');
  });

  it('registers a declarative Java field (int / string / bytes)', async () => {
    const sessionId = await freshSession();
    const asInt = payload(
      await handlers.handleSetupJavaField({
        sessionId,
        className: 'com/app/Config',
        fieldName: 'magic',
        signature: 'I',
        valueInt: 1337,
      }),
    );
    expect(asInt.success).toBe(true);
    expect(asInt.kind).toBe('int');

    const asString = payload(
      await handlers.handleSetupJavaField({
        sessionId,
        className: 'com/app/Config',
        fieldName: 'salt',
        signature: 'Ljava/lang/String;',
        valueString: 'pepper',
      }),
    );
    expect(asString.kind).toBe('string');

    const asBytes = payload(
      await handlers.handleSetupJavaField({
        sessionId,
        className: 'com/app/Config',
        fieldName: 'key',
        signature: '[B',
        valueBytes: Buffer.from([1, 2, 3]).toString('base64'),
      }),
    );
    expect(asBytes.kind).toBe('bytes');
  });

  it('rejects Java fields with multiple value kinds', async () => {
    const sessionId = await freshSession();
    const res = payload(
      await handlers.handleSetupJavaField({
        sessionId,
        className: 'com/app/Config',
        fieldName: 'magic',
        signature: 'I',
        valueInt: 1337,
        valueString: 'pepper',
      }),
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('valueInt, valueString, and valueBytes');
  });

  it('traces an exported symbol instruction-by-instruction', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleTrace({
        sessionId,
        symbol: 'add_two',
        args: [5, 6],
        captureRegisters: ['x0'],
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(11);
    expect(res.steps).toBeGreaterThan(0);
    expect(Array.isArray(res.trace)).toBe(true);
  });

  it('persists trace artifacts and limits inline trace rows when requested', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleTrace({
        sessionId,
        symbol: 'add_two',
        args: [5, 6],
        captureRegisters: ['x0'],
        persistArtifact: true,
        traceInlineLimit: 1,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(11);
    expect((res.trace as unknown[]).length).toBe(1);
    expect(res.traceInlineLimit).toBe(1);
    expect(res.traceArtifact).toEqual(
      expect.objectContaining({
        category: 'traces',
        eventCount: res.steps,
      }),
    );
    const artifact = res.traceArtifact as Record<string, unknown>;
    const artifactJson = JSON.parse(await readFile(String(artifact.path), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(artifactJson.symbol).toBe('add_two');
    expect(artifactJson.trace).toEqual(expect.any(Array));
  });

  it('destroys a session', async () => {
    const sessionId = await freshSession();
    const res = payload(await handlers.handleDestroySession({ sessionId }));
    expect(res.destroyed).toBe(true);
    expect(res.activeSessions).toBe(0);
  });
});

describe('NativeEmulatorHandlers — isolation & errors', () => {
  let handlers: NativeEmulatorHandlers;
  afterEach(() => handlers.dispose());

  it('keeps two sessions isolated — a symbol loaded in one is unknown in the other', async () => {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const a = payload(await handlers.handleCreateSession({ installSyscalls: false }))
      .sessionId as string;
    const b = payload(await handlers.handleCreateSession({ installSyscalls: false }))
      .sessionId as string;
    await handlers.handleLoadLibrary({ sessionId: a, soPath });
    const symsA = payload(await handlers.handleListSymbols({ sessionId: a }));
    const symsB = payload(await handlers.handleListSymbols({ sessionId: b }));
    expect(symsA.symbols).toEqual(['add_two']);
    expect(symsB.symbols).toEqual([]); // b never loaded anything
  });

  it('returns a failure response for an unknown session', async () => {
    handlers = new NativeEmulatorHandlers();
    const res = payload(await handlers.handleListSymbols({ sessionId: 'does-not-exist' }));
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('Unknown emulator session');
  });

  it('returns a failure response when sessionId is missing', async () => {
    handlers = new NativeEmulatorHandlers();
    const res = payload(await handlers.handleLoadLibrary({}));
    expect(res.success).toBe(false);
  });

  it('returns a failure response for a non-byte-array handle', async () => {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const sessionId = payload(await handlers.handleCreateSession({ installSyscalls: false }))
      .sessionId as string;
    const res = payload(await handlers.handleReadByteArray({ sessionId, handle: 0xdeadbeef }));
    expect(res.success).toBe(false);
  });

  it('auto-NOPs NULL indirect calls (BLR x0 → RET with result 0)', async () => {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const sessionId = payload(await handlers.handleCreateSession({ installSyscalls: false }))
      .sessionId as string;
    await handlers.handleLoadLibrary({ sessionId, soPath: nullCallSoPath });

    const res = payload(await handlers.handleCallSymbol({ sessionId, symbol: 'call_null' }));
    expect(res.success).toBe(true);
    expect(res.symbol).toBe('call_null');
    // BLR through x8=0 is auto-patched to RET; x0=0 cleanly returned.
    expect(res.result).toBe(0);
    expect(res.diagnostics).toEqual(
      expect.objectContaining({
        unresolvedImports: [],
        constructorFaults: [],
      }),
    );
    // The auto-NOP patch is recorded for diagnostics.
    const diag = res.diagnostics as Record<string, unknown>;
    expect(diag.autoNopPatches).toBeInstanceOf(Array);
  });

  it('reports destroyed:false when destroying an unknown session', async () => {
    handlers = new NativeEmulatorHandlers();
    const res = payload(await handlers.handleDestroySession({ sessionId: 'ghost' }));
    expect(res.success).toBe(true);
    expect(res.destroyed).toBe(false);
  });
});
