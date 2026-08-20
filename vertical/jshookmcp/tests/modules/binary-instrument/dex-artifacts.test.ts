import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findDexArtifacts, summarizeDexBuffer } from '@modules/binary-instrument/dex-artifacts';

describe('dex-artifacts', () => {
  it('summarizes DEX string/type/proto/field/method/class reference tables', () => {
    const artifact = summarizeDexBuffer('classes.dex', referenceDexBuffer());

    expect(artifact.header).toMatchObject({
      stringIdsSize: 7,
      typeIdsSize: 4,
      protoIdsSize: 1,
      fieldIdsSize: 1,
      methodIdsSize: 1,
      classDefsSize: 1,
    });
    expect(artifact.stringsPreview).toEqual([
      'Lx/A;',
      'Ljava/lang/Object;',
      'V',
      'I',
      'doWork',
      'value',
      'VI',
    ]);
    expect(artifact.typeDescriptorsPreview).toEqual(['Lx/A;', 'Ljava/lang/Object;', 'V', 'I']);
    expect(artifact.protoIdsPreview).toEqual([
      {
        protoIdx: 0,
        shorty: 'VI',
        returnType: 'V',
        parameters: ['I'],
      },
    ]);
    expect(artifact.fieldIdsPreview).toEqual([
      {
        fieldIdx: 0,
        classType: 'Lx/A;',
        type: 'I',
        name: 'value',
        descriptor: 'Lx/A;->value:I',
      },
    ]);
    expect(artifact.methodIdsPreview).toEqual([
      {
        methodIdx: 0,
        classType: 'Lx/A;',
        protoIdx: 0,
        name: 'doWork',
        returnType: 'V',
        parameters: ['I'],
        descriptor: 'Lx/A;->doWork(I)V',
      },
    ]);
    expect(artifact.classDefsPreview).toEqual([
      {
        classIdx: 0,
        classType: 'Lx/A;',
        superClassIdx: 1,
        superClassType: 'Ljava/lang/Object;',
        accessFlags: 1,
      },
    ]);
    expect(artifact.mapItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ typeName: 'proto_id', size: 1, offset: 0x100 }),
        expect.objectContaining({ typeName: 'field_id', size: 1, offset: 0x110 }),
        expect.objectContaining({ typeName: 'method_id', size: 1, offset: 0x118 }),
        expect.objectContaining({ typeName: 'type_list', size: 1, offset: 0x150 }),
      ]),
    );
  });

  it('caps scanned DEX file bytes and marks partial artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jshook-dex-artifacts-'));
    try {
      const largeDex = Buffer.concat([referenceDexBuffer(), Buffer.alloc(1024, 0x41)]);
      await writeFile(join(root, 'classes.dex'), largeDex);

      const artifacts = await findDexArtifacts({
        rootDir: root,
        maxFileBytes: 128,
      });

      expect(artifacts).toMatchObject([
        {
          path: 'classes.dex',
          kind: 'dex',
          size: 128,
          sourceSize: largeDex.length,
          truncated: true,
          header: { fileSize: 0x220 },
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function referenceDexBuffer(): Buffer {
  const buffer = Buffer.alloc(0x220, 0);
  buffer.write('dex\n035\0', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length, 32);
  buffer.writeUInt32LE(0x70, 36);
  buffer.writeUInt32LE(0x12345678, 40);
  buffer.writeUInt32LE(0x70, 52);
  buffer.writeUInt32LE(7, 56);
  buffer.writeUInt32LE(0xd0, 60);
  buffer.writeUInt32LE(4, 64);
  buffer.writeUInt32LE(0xf0, 68);
  buffer.writeUInt32LE(1, 72);
  buffer.writeUInt32LE(0x100, 76);
  buffer.writeUInt32LE(1, 80);
  buffer.writeUInt32LE(0x110, 84);
  buffer.writeUInt32LE(1, 88);
  buffer.writeUInt32LE(0x118, 92);
  buffer.writeUInt32LE(1, 96);
  buffer.writeUInt32LE(0x120, 100);

  writeMap(buffer, 0x70, [
    [0x0001, 7, 0xd0],
    [0x0002, 4, 0xf0],
    [0x0003, 1, 0x100],
    [0x0004, 1, 0x110],
    [0x0005, 1, 0x118],
    [0x0006, 1, 0x120],
    [0x1001, 1, 0x150],
  ]);

  [0x160, 0x170, 0x190, 0x194, 0x198, 0x1a0, 0x1a8].forEach((offset, index) =>
    buffer.writeUInt32LE(offset, 0xd0 + index * 4),
  );
  [0, 1, 2, 3].forEach((stringIndex, index) => buffer.writeUInt32LE(stringIndex, 0xf0 + index * 4));

  buffer.writeUInt32LE(6, 0x100);
  buffer.writeUInt32LE(2, 0x104);
  buffer.writeUInt32LE(0x150, 0x108);

  buffer.writeUInt16LE(0, 0x110);
  buffer.writeUInt16LE(3, 0x112);
  buffer.writeUInt32LE(5, 0x114);

  buffer.writeUInt16LE(0, 0x118);
  buffer.writeUInt16LE(0, 0x11a);
  buffer.writeUInt32LE(4, 0x11c);

  buffer.writeUInt32LE(0, 0x120);
  buffer.writeUInt32LE(1, 0x124);
  buffer.writeUInt32LE(1, 0x128);
  buffer.writeUInt32LE(0xffffffff, 0x12c);

  buffer.writeUInt32LE(1, 0x150);
  buffer.writeUInt16LE(3, 0x154);

  writeDexString(buffer, 0x160, 'Lx/A;');
  writeDexString(buffer, 0x170, 'Ljava/lang/Object;');
  writeDexString(buffer, 0x190, 'V');
  writeDexString(buffer, 0x194, 'I');
  writeDexString(buffer, 0x198, 'doWork');
  writeDexString(buffer, 0x1a0, 'value');
  writeDexString(buffer, 0x1a8, 'VI');
  return buffer;
}

function writeMap(buffer: Buffer, offset: number, entries: Array<[number, number, number]>): void {
  buffer.writeUInt32LE(entries.length, offset);
  entries.forEach(([type, size, itemOffset], index) => {
    const base = offset + 4 + index * 12;
    buffer.writeUInt16LE(type, base);
    buffer.writeUInt32LE(size, base + 4);
    buffer.writeUInt32LE(itemOffset, base + 8);
  });
}

function writeDexString(buffer: Buffer, offset: number, value: string): void {
  buffer[offset] = value.length;
  buffer.write(value, offset + 1, 'utf8');
  buffer[offset + 1 + value.length] = 0;
}
