import { open, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';

export interface DexHeaderSummary {
  version?: string;
  fileSize?: number;
  headerSize?: number;
  endianTag?: string;
  mapOff?: number;
  stringIdsSize?: number;
  typeIdsSize?: number;
  protoIdsSize?: number;
  fieldIdsSize?: number;
  methodIdsSize?: number;
  classDefsSize?: number;
}

export interface DexMapItemSummary {
  type: number;
  typeName: string;
  size: number;
  offset: number;
}

export interface DexClassDefSummary {
  classIdx: number;
  classType?: string;
  superClassIdx?: number;
  superClassType?: string;
  accessFlags: number;
}

export interface DexProtoIdSummary {
  protoIdx: number;
  shorty?: string;
  returnType?: string;
  parameters: string[];
}

export interface DexFieldIdSummary {
  fieldIdx: number;
  classType?: string;
  type?: string;
  name?: string;
  descriptor?: string;
}

export interface DexMethodIdSummary {
  methodIdx: number;
  classType?: string;
  protoIdx: number;
  name?: string;
  returnType?: string;
  parameters: string[];
  descriptor?: string;
}

export interface DexFileArtifact {
  path: string;
  kind: 'dex' | 'cdex';
  size: number;
  sourceSize?: number;
  truncated?: boolean;
  header: DexHeaderSummary;
  mapItems?: DexMapItemSummary[];
  stringsPreview?: string[];
  typeDescriptorsPreview?: string[];
  protoIdsPreview?: DexProtoIdSummary[];
  fieldIdsPreview?: DexFieldIdSummary[];
  methodIdsPreview?: DexMethodIdSummary[];
  classDefsPreview?: DexClassDefSummary[];
}

export interface FindDexArtifactsOptions {
  rootDir: string;
  limit?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export function isDexArtifactPath(path: string): boolean {
  return /\.(dex|cdex)$/i.test(path);
}

export function summarizeDexBuffer(path: string, buffer: Buffer): DexFileArtifact {
  const magic = getReverseEngineeringConfig().binaryMagic;
  const kind = buffer.subarray(0, 4).equals(Buffer.from(magic.compactDexMagicAscii, 'ascii'))
    ? 'cdex'
    : 'dex';
  const version = buffer.subarray(4, 7).toString('latin1').replaceAll('\u0000', '') || undefined;
  const header: DexHeaderSummary = { version };
  if (buffer.length >= 0x70 && kind === 'dex') {
    header.fileSize = buffer.readUInt32LE(32);
    header.headerSize = buffer.readUInt32LE(36);
    header.endianTag = `0x${buffer.readUInt32LE(40).toString(16)}`;
    header.mapOff = buffer.readUInt32LE(52);
    header.stringIdsSize = buffer.readUInt32LE(56);
    header.typeIdsSize = buffer.readUInt32LE(64);
    header.protoIdsSize = buffer.readUInt32LE(72);
    header.fieldIdsSize = buffer.readUInt32LE(80);
    header.methodIdsSize = buffer.readUInt32LE(88);
    header.classDefsSize = buffer.readUInt32LE(96);
  }
  const strings = kind === 'dex' ? readStringTable(buffer, header, 50) : [];
  const typeDescriptors = kind === 'dex' ? readTypeDescriptors(buffer, header, strings, 50) : [];
  const mapItems = kind === 'dex' ? readMapItems(buffer, header, 100) : [];
  const protoIds = kind === 'dex' ? readProtoIds(buffer, header, strings, typeDescriptors, 50) : [];
  const fieldIds = kind === 'dex' ? readFieldIds(buffer, header, strings, typeDescriptors, 50) : [];
  const methodIds =
    kind === 'dex' ? readMethodIds(buffer, header, strings, typeDescriptors, protoIds, 50) : [];
  const classDefs = kind === 'dex' ? readClassDefs(buffer, header, typeDescriptors, 50) : [];
  return {
    path,
    kind,
    size: buffer.length,
    header,
    ...(mapItems.length > 0 ? { mapItems } : {}),
    ...(strings.length > 0 ? { stringsPreview: strings } : {}),
    ...(typeDescriptors.length > 0 ? { typeDescriptorsPreview: typeDescriptors } : {}),
    ...(protoIds.length > 0 ? { protoIdsPreview: protoIds } : {}),
    ...(fieldIds.length > 0 ? { fieldIdsPreview: fieldIds } : {}),
    ...(methodIds.length > 0 ? { methodIdsPreview: methodIds } : {}),
    ...(classDefs.length > 0 ? { classDefsPreview: classDefs } : {}),
  };
}

function readStringTable(buffer: Buffer, header: DexHeaderSummary, limit: number): string[] {
  const size = header.stringIdsSize ?? 0;
  const offset = readHeaderOffset(buffer, 60);
  if (!offset || size <= 0) return [];
  const out: string[] = [];
  const count = Math.min(size, limit);
  for (let i = 0; i < count; i++) {
    const stringDataOffset = readU32(buffer, offset + i * 4);
    if (!stringDataOffset) continue;
    const parsed = readDexString(buffer, stringDataOffset);
    if (parsed) out.push(parsed);
  }
  return out;
}

function readTypeDescriptors(
  buffer: Buffer,
  header: DexHeaderSummary,
  strings: string[],
  limit: number,
): string[] {
  const size = header.typeIdsSize ?? 0;
  const offset = readHeaderOffset(buffer, 68);
  if (!offset || size <= 0) return [];
  const out: string[] = [];
  const count = Math.min(size, limit);
  for (let i = 0; i < count; i++) {
    const descriptorIdx = readU32(buffer, offset + i * 4);
    if (descriptorIdx === undefined) continue;
    const descriptor = strings[descriptorIdx];
    if (descriptor) out.push(descriptor);
  }
  return out;
}

function readClassDefs(
  buffer: Buffer,
  header: DexHeaderSummary,
  typeDescriptors: string[],
  limit: number,
): DexClassDefSummary[] {
  const size = header.classDefsSize ?? 0;
  const offset = readHeaderOffset(buffer, 100);
  if (!offset || size <= 0) return [];
  const out: DexClassDefSummary[] = [];
  const count = Math.min(size, limit);
  for (let i = 0; i < count; i++) {
    const base = offset + i * 32;
    const classIdx = readU32(buffer, base);
    const accessFlags = readU32(buffer, base + 4);
    const superClassIdx = readU32(buffer, base + 8);
    if (classIdx === undefined || accessFlags === undefined) continue;
    out.push({
      classIdx,
      classType: typeDescriptors[classIdx],
      ...(superClassIdx !== undefined && superClassIdx !== 0xffffffff
        ? { superClassIdx, superClassType: typeDescriptors[superClassIdx] }
        : {}),
      accessFlags,
    });
  }
  return out;
}

function readProtoIds(
  buffer: Buffer,
  header: DexHeaderSummary,
  strings: string[],
  typeDescriptors: string[],
  limit: number,
): DexProtoIdSummary[] {
  const size = header.protoIdsSize ?? 0;
  const offset = readHeaderOffset(buffer, 76);
  if (!offset || size <= 0) return [];
  const out: DexProtoIdSummary[] = [];
  const count = Math.min(size, limit);
  for (let i = 0; i < count; i++) {
    const base = offset + i * 12;
    const shortyIdx = readU32(buffer, base);
    const returnTypeIdx = readU32(buffer, base + 4);
    const parametersOff = readU32(buffer, base + 8);
    if (shortyIdx === undefined || returnTypeIdx === undefined) continue;
    out.push({
      protoIdx: i,
      shorty: strings[shortyIdx],
      returnType: typeDescriptors[returnTypeIdx],
      parameters: parametersOff ? readTypeList(buffer, parametersOff, typeDescriptors, 50) : [],
    });
  }
  return out;
}

function readFieldIds(
  buffer: Buffer,
  header: DexHeaderSummary,
  strings: string[],
  typeDescriptors: string[],
  limit: number,
): DexFieldIdSummary[] {
  const size = header.fieldIdsSize ?? 0;
  const offset = readHeaderOffset(buffer, 84);
  if (!offset || size <= 0) return [];
  const out: DexFieldIdSummary[] = [];
  const count = Math.min(size, limit);
  for (let i = 0; i < count; i++) {
    const base = offset + i * 8;
    if (base + 8 > buffer.length) break;
    const classIdx = buffer.readUInt16LE(base);
    const typeIdx = buffer.readUInt16LE(base + 2);
    const nameIdx = buffer.readUInt32LE(base + 4);
    const classType = typeDescriptors[classIdx];
    const type = typeDescriptors[typeIdx];
    const name = strings[nameIdx];
    out.push({
      fieldIdx: i,
      classType,
      type,
      name,
      ...(classType && name && type ? { descriptor: `${classType}->${name}:${type}` } : {}),
    });
  }
  return out;
}

function readMethodIds(
  buffer: Buffer,
  header: DexHeaderSummary,
  strings: string[],
  typeDescriptors: string[],
  protoIds: DexProtoIdSummary[],
  limit: number,
): DexMethodIdSummary[] {
  const size = header.methodIdsSize ?? 0;
  const offset = readHeaderOffset(buffer, 92);
  if (!offset || size <= 0) return [];
  const out: DexMethodIdSummary[] = [];
  const count = Math.min(size, limit);
  for (let i = 0; i < count; i++) {
    const base = offset + i * 8;
    if (base + 8 > buffer.length) break;
    const classIdx = buffer.readUInt16LE(base);
    const protoIdx = buffer.readUInt16LE(base + 2);
    const nameIdx = buffer.readUInt32LE(base + 4);
    const classType = typeDescriptors[classIdx];
    const proto = protoIds[protoIdx];
    const name = strings[nameIdx];
    const parameters = proto?.parameters ?? [];
    const returnType = proto?.returnType;
    out.push({
      methodIdx: i,
      classType,
      protoIdx,
      name,
      returnType,
      parameters,
      ...(classType && name && returnType
        ? { descriptor: `${classType}->${name}(${parameters.join('')})${returnType}` }
        : {}),
    });
  }
  return out;
}

function readTypeList(
  buffer: Buffer,
  offset: number,
  typeDescriptors: string[],
  limit: number,
): string[] {
  if (offset + 4 > buffer.length) return [];
  const size = readU32(buffer, offset) ?? 0;
  const out: string[] = [];
  const count = Math.min(size, limit);
  for (let i = 0; i < count; i++) {
    const itemOffset = offset + 4 + i * 2;
    if (itemOffset + 2 > buffer.length) break;
    const typeIdx = buffer.readUInt16LE(itemOffset);
    const descriptor = typeDescriptors[typeIdx];
    if (descriptor) out.push(descriptor);
  }
  return out;
}

function readMapItems(
  buffer: Buffer,
  header: DexHeaderSummary,
  limit: number,
): DexMapItemSummary[] {
  const offset = header.mapOff;
  if (!offset || offset + 4 > buffer.length) return [];
  const size = readU32(buffer, offset) ?? 0;
  const out: DexMapItemSummary[] = [];
  const count = Math.min(size, limit);
  for (let i = 0; i < count; i++) {
    const base = offset + 4 + i * 12;
    if (base + 12 > buffer.length) break;
    const type = buffer.readUInt16LE(base);
    const itemSize = buffer.readUInt32LE(base + 4);
    const itemOffset = buffer.readUInt32LE(base + 8);
    out.push({ type, typeName: mapItemTypeName(type), size: itemSize, offset: itemOffset });
  }
  return out;
}

function readDexString(buffer: Buffer, offset: number): string | undefined {
  if (offset >= buffer.length) return undefined;
  const uleb = readUleb128(buffer, offset);
  if (!uleb) return undefined;
  const start = uleb.nextOffset;
  let end = start;
  const maxEnd = Math.min(
    buffer.length,
    start + getReverseEngineeringConfig().dex.stringScanMaxBytes,
  );
  while (end < maxEnd && buffer[end] !== 0) end += 1;
  if (end >= buffer.length) return undefined;
  return buffer.subarray(start, end).toString('utf8');
}

function readUleb128(
  buffer: Buffer,
  offset: number,
): { value: number; nextOffset: number } | undefined {
  let result = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    const currentOffset = offset + i;
    if (currentOffset >= buffer.length) return undefined;
    const byte = buffer[currentOffset]!;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, nextOffset: currentOffset + 1 };
    shift += 7;
  }
  return undefined;
}

function readHeaderOffset(buffer: Buffer, headerOffset: number): number | undefined {
  const value = readU32(buffer, headerOffset);
  return value && value < buffer.length ? value : undefined;
}

function readU32(buffer: Buffer, offset: number): number | undefined {
  return offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : undefined;
}

function mapItemTypeName(type: number): string {
  switch (type) {
    case 0x0000:
      return 'header';
    case 0x0001:
      return 'string_id';
    case 0x0002:
      return 'type_id';
    case 0x0003:
      return 'proto_id';
    case 0x0004:
      return 'field_id';
    case 0x0005:
      return 'method_id';
    case 0x0006:
      return 'class_def';
    case 0x1000:
      return 'map_list';
    case 0x1001:
      return 'type_list';
    case 0x2000:
      return 'class_data';
    case 0x2001:
      return 'code';
    case 0x2002:
      return 'string_data';
    default:
      return `unknown_${type.toString(16)}`;
  }
}

export async function findDexArtifacts(
  options: FindDexArtifactsOptions,
): Promise<DexFileArtifact[]> {
  const config = getReverseEngineeringConfig().dex;
  const limit = Math.max(
    1,
    Math.min(Math.floor(options.limit ?? config.artifactDefaultLimit), config.artifactMaxLimit),
  );
  const maxFileBytes = clampInt(
    options.maxFileBytes ?? config.artifactDefaultMaxFileBytes,
    config.artifactMinReadBytes,
    config.artifactMaxReadBytes,
  );
  const maxTotalBytes = clampInt(
    options.maxTotalBytes ?? config.artifactDefaultMaxTotalBytes,
    config.artifactMinReadBytes,
    config.artifactMaxReadBytes,
  );
  const artifacts: DexFileArtifact[] = [];
  let totalBytesRead = 0;

  const walk = async (directory: string): Promise<void> => {
    if (artifacts.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (artifacts.length >= limit) return;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !isDexArtifactPath(entry.name)) continue;
      const fileStat = await stat(fullPath).catch(() => undefined);
      if (!fileStat?.isFile()) continue;
      const remaining = maxTotalBytes - totalBytesRead;
      if (remaining <= 0) return;
      const bytesToRead = Math.min(fileStat.size, maxFileBytes, remaining);
      if (bytesToRead <= 0) continue;
      const buffer = await readFilePrefix(fullPath, bytesToRead);
      totalBytesRead += buffer.length;
      const summary = summarizeDexBuffer(
        relative(options.rootDir, fullPath).replace(/\\/g, '/'),
        buffer,
      );
      artifacts.push({
        ...summary,
        ...(fileStat.size !== summary.size ? { sourceSize: fileStat.size, truncated: true } : {}),
      });
    }
  };

  await walk(options.rootDir);
  return artifacts;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.floor(value), max));
}

async function readFilePrefix(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
