/**
 * SnapshotParser — Dart AOT snapshot cluster & code object extraction.
 *
 * Parses the Dart isolate snapshot binary format to extract:
 *  - Snapshot header (magic, version, features, offsets)
 *  - Cluster structure (Code, ObjectPool, PcDescriptors, Instructions)
 *  - Code objects (Dart functions compiled to ARM64 machine code)
 *
 * This is the **execution-layer** parser that feeds the native emulator,
 * whereas `SnapshotFingerprint` is a static **analysis-layer** tool that
 * only reads the header for version identification.
 *
 * References:
 *  - Dart SDK: `runtime/vm/clustered_snapshot.cc`
 *  - blutter: snapshot deserialization logic
 *  - reFlutter: Dart object structure definitions
 *
 * Design constraints:
 *  - Must handle both symbol-located and byte-scan-located snapshots
 *  - Must tolerate stripped binaries (no .dynsym → fallback to byte scan)
 *  - Must validate cluster integrity (bounds checks, magic verification)
 *  - Must expose raw ARM64 instructions for CpuEngine consumption
 */

import { ToolError } from '@errors/ToolError';
import { DART_SNAPSHOT_MAGIC } from '@modules/dart-inspector/snapshot-types';

/** Snapshot header fields (little-endian layout). */
export interface SnapshotHeader {
  /** Magic number — always {@link DART_SNAPSHOT_MAGIC} (0xf5f5dcdc). */
  magic: number;
  /** Snapshot kind: 0=full, 2=full-aot, 3=full-jit, 4=full-core. */
  kind: number;
  /** Snapshot identity hash (32 bytes). */
  hash: Uint8Array;
  /** Feature flags (8 bytes, bit-packed). */
  features: bigint;
  /** Base object count in the snapshot. */
  baseObjects: number;
  /** Total object count. */
  numObjects: number;
  /** Number of clusters in the snapshot. */
  numClusters: number;
  /** Field table length. */
  fieldTableLen: number;
  /** Absolute offset to code section. */
  codeStartOffset: bigint;
  /** Absolute offset to data section. */
  dataStartOffset: bigint;
}

/** Cluster types recognized in Dart snapshots. */
export type ClusterType = 'Code' | 'ObjectPool' | 'PcDescriptors' | 'Instructions' | 'Unknown';

/** A decoded cluster within the snapshot. */
export interface Cluster {
  /** Cluster type identifier. */
  type: ClusterType;
  /** Absolute offset in file where this cluster starts. */
  offset: bigint;
  /** Number of objects in this cluster. */
  count: number;
  /** Individual objects within the cluster. */
  objects: ClusterObject[];
}

/** A single object within a cluster. */
export interface ClusterObject {
  /** Class ID (cid) — identifies the Dart VM class. */
  cid: number;
  /** Absolute offset in file. */
  offset: bigint;
  /** Size in bytes of this object's serialized data. */
  size: number;
  /** Raw serialized data. */
  data: Uint8Array;
}

/** A parsed Dart Code object (compiled function). */
export interface DartCode {
  /** Function name (if available from debug info or symbol tables). */
  name?: string;
  /** Entry point address (where to jump to call this function). */
  entryPoint: bigint;
  /** Size of the code in bytes. */
  size: number;
  /** Offset to the ObjectPool this code references. */
  objectPool: bigint;
  /** Offset to PcDescriptors (source maps, stack maps). */
  pcDescriptors: bigint;
  /** Raw ARM64 machine code bytes. */
  instructions: Uint8Array;
}

/**
 * Parse the snapshot header from the beginning of a snapshot buffer.
 * Throws {@link ToolError} with code `VALIDATION` if the magic is invalid.
 */
export function parseSnapshotHeader(buffer: Uint8Array): SnapshotHeader {
  if (buffer.length < 0x50) {
    throw new ToolError('VALIDATION', 'Snapshot buffer too small for header (need >= 80 bytes)', {
      details: { bufferSize: buffer.length },
    });
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Try magic in both endianness — newer Flutter SDKs may store the snapshot
  // with the raw bytes in a different order inside the ELF .rodata section.
  let magic = view.getUint32(0, true);
  let isNewFormat = false;
  if (magic !== DART_SNAPSHOT_MAGIC) {
    // Try byte-swapped: reverse the 4 bytes and re-read
    const swapped = new Uint8Array(4);
    swapped[0] = buffer[3]!;
    swapped[1] = buffer[2]!;
    swapped[2] = buffer[1]!;
    swapped[3] = buffer[0]!;
    const swappedView = new DataView(swapped.buffer);
    magic = swappedView.getUint32(0, true);
    if (magic === DART_SNAPSHOT_MAGIC) {
      isNewFormat = true;
    } else {
      throw new ToolError('VALIDATION', `Invalid Dart snapshot magic: 0x${magic.toString(16)}`, {
        details: {
          expected: `0x${DART_SNAPSHOT_MAGIC.toString(16)}`,
          actual: `0x${magic.toString(16)}`,
        },
      });
    }
  }

  // +0x04: kind (legacy) or version word (newer format). Valid kinds are 0-4;
  // values > 4 indicate a newer SDK header layout.
  const word04 = view.getUint32(4, true);
  const isNewHeader = isNewFormat || word04 > 4;

  let kind: number;
  let hash: Uint8Array;
  let features: bigint;
  let baseObjects: number;
  let numObjects: number;
  let numClusters: number;
  let fieldTableLen: number;
  let codeStartOffset: bigint;
  let dataStartOffset: bigint;

  if (!isNewHeader) {
    // Legacy format (Flutter ≤3.x, Dart ≤2.19): fixed-offset binary layout.
    kind = word04;
    hash = buffer.slice(0x08, 0x28);
    features = view.getBigUint64(0x28, true);
    baseObjects = view.getUint32(0x30, true);
    numObjects = view.getUint32(0x34, true);
    numClusters = view.getUint32(0x38, true);
    fieldTableLen = view.getUint32(0x3c, true);
    codeStartOffset = view.getBigUint64(0x40, true);
    dataStartOffset = view.getBigUint64(0x48, true);
  } else {
    // Newer format (Flutter ≥3.19, Dart ≥3.3):
    // +0x00: magic (4 bytes, may be byte-swapped in ELF .rodata)
    // +0x04: version (4 bytes, >4 → newer format)
    // +0x08: flags (4 bytes)
    // +0x0c: target_arch (4 bytes, 3=arm64)
    // +0x10: reserved (4 bytes)
    // +0x14: snapshot hash as ASCII hex (32 bytes → 16-byte hash)
    // +0x34: features string (null-terminated ASCII)
    // After features string: baseObjects/numObjects/numClusters... at aligned offset
    const hashStr = new TextDecoder().decode(buffer.slice(0x14, 0x34));
    const binaryHash = new Uint8Array(16);
    for (let i = 0; i < 16 && i * 2 < hashStr.length; i++) {
      binaryHash[i] = parseInt(hashStr.substring(i * 2, i * 2 + 2), 16) || 0;
    }
    hash = binaryHash;

    // Find the null-terminated features string starting at +0x34
    let featEnd = 0x34;
    while (featEnd < buffer.length && buffer[featEnd] !== 0) featEnd++;
    if (featEnd === buffer.length) {
      throw new ToolError('VALIDATION', 'Modern snapshot features string is not terminated');
    }
    const featuresStr = new TextDecoder().decode(buffer.slice(0x34, featEnd));
    let featHash = 0n;
    for (let i = 0; i < featuresStr.length && i < 8; i++) {
      featHash = (featHash << 8n) | BigInt(featuresStr.charCodeAt(i) ?? 0);
    }
    features = featHash;

    const commonHeaderOffset = (featEnd + 1 + 7) & ~7;
    const commonHeaderEnd = commonHeaderOffset + 32;
    if (commonHeaderEnd > buffer.length) {
      throw new ToolError('VALIDATION', 'Modern snapshot common header is truncated');
    }

    kind = 2; // full-aot
    baseObjects = view.getUint32(commonHeaderOffset, true);
    numObjects = view.getUint32(commonHeaderOffset + 4, true);
    numClusters = view.getUint32(commonHeaderOffset + 8, true);
    fieldTableLen = view.getUint32(commonHeaderOffset + 12, true);
    codeStartOffset = view.getBigUint64(commonHeaderOffset + 16, true);
    dataStartOffset = view.getBigUint64(commonHeaderOffset + 24, true);

    const dataStart = Number(dataStartOffset);
    const minimumClusterBytes = numClusters * 16;
    if (
      !Number.isSafeInteger(dataStart) ||
      dataStart < commonHeaderEnd ||
      dataStart > buffer.length ||
      minimumClusterBytes > buffer.length - dataStart
    ) {
      throw new ToolError('VALIDATION', 'Modern snapshot cluster boundaries are invalid', {
        details: {
          dataStartOffset: dataStartOffset.toString(),
          numClusters,
          bufferSize: buffer.length,
        },
      });
    }
  }

  return {
    magic,
    kind,
    hash,
    features,
    baseObjects,
    numObjects,
    numClusters,
    fieldTableLen,
    codeStartOffset,
    dataStartOffset,
  };
}

/**
 * Parse a single cluster starting at the given offset.
 * Returns the cluster and the next offset to continue parsing.
 */
export function parseCluster(
  buffer: Uint8Array,
  offset: bigint,
): { cluster: Cluster; nextOffset: bigint } {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const off = Number(offset);

  if (off + 16 > buffer.length) {
    throw new ToolError('VALIDATION', `Cluster offset ${offset} exceeds buffer bounds`, {
      details: { offset: offset.toString(), bufferSize: buffer.length },
    });
  }

  // Cluster header format (simplified, real format varies by Dart version):
  // +0x00: type identifier (4 bytes)
  // +0x04: count (4 bytes)
  // +0x08: reserved (8 bytes)
  const typeId = view.getUint32(off, true);
  const count = view.getUint32(off + 4, true);

  const type = clusterTypeFromId(typeId);
  const objects: ClusterObject[] = [];

  let currentOffset = BigInt(off + 16);

  // Parse each object in the cluster
  for (let i = 0; i < count; i++) {
    const objOff = Number(currentOffset);
    if (objOff + 12 > buffer.length) break; // Graceful truncation

    const cid = view.getUint32(objOff, true);
    const size = view.getUint32(objOff + 4, true);

    const dataStart = objOff + 8;
    const dataEnd = Math.min(dataStart + size, buffer.length);
    const data = buffer.slice(dataStart, dataEnd);

    objects.push({
      cid,
      offset: currentOffset,
      size,
      data,
    });

    currentOffset += BigInt(8 + size);
  }

  return {
    cluster: {
      type,
      offset,
      count,
      objects,
    },
    nextOffset: currentOffset,
  };
}

/**
 * Map cluster type ID to human-readable name.
 * Real IDs are defined in `runtime/vm/class_id.h` — this is a simplified subset.
 */
function clusterTypeFromId(id: number): ClusterType {
  // Approximate mapping (Dart VM internal class IDs)
  if (id >= 100 && id < 120) return 'Code';
  if (id >= 120 && id < 140) return 'ObjectPool';
  if (id >= 140 && id < 160) return 'PcDescriptors';
  if (id >= 160 && id < 180) return 'Instructions';
  return 'Unknown';
}

/**
 * Extract all Code objects from a snapshot buffer.
 * Scans all clusters, filters for Code cluster type, and parses each code object.
 */
export function extractCodeObjects(snapshot: Uint8Array): DartCode[] {
  const header = parseSnapshotHeader(snapshot);
  const codes: DartCode[] = [];

  let currentOffset = header.dataStartOffset;

  // Parse all clusters
  for (let i = 0; i < header.numClusters; i++) {
    if (Number(currentOffset) >= snapshot.length) break;

    const { cluster, nextOffset } = parseCluster(snapshot, currentOffset);
    currentOffset = nextOffset;

    // Only process Code clusters
    if (cluster.type !== 'Code') continue;

    // Parse each Code object
    for (const obj of cluster.objects) {
      const code = parseCodeObject(obj, snapshot);
      if (code) codes.push(code);
    }
  }

  return codes;
}

/**
 * Parse a single Code object from its serialized data.
 * Returns undefined if the object is malformed.
 */
function parseCodeObject(obj: ClusterObject, fullSnapshot: Uint8Array): DartCode | undefined {
  if (obj.data.length < 32) return undefined; // Too small to be valid

  const view = new DataView(obj.data.buffer, obj.data.byteOffset, obj.data.byteLength);

  try {
    // Code object layout (simplified):
    // +0x00: entry_point (8 bytes, relative offset)
    // +0x08: size (4 bytes)
    // +0x0c: object_pool_offset (8 bytes)
    // +0x14: pc_descriptors_offset (8 bytes)
    // +0x1c: instructions_offset (8 bytes)
    const entryPoint = view.getBigUint64(0, true);
    const size = view.getUint32(8, true);
    const objectPool = view.getBigUint64(12, true);
    const pcDescriptors = view.getBigUint64(20, true);
    const instructionsOffset = Number(view.getBigUint64(28, true));

    // Extract instructions from the full snapshot
    const instructions = fullSnapshot.slice(instructionsOffset, instructionsOffset + size);

    return {
      entryPoint,
      size,
      objectPool,
      pcDescriptors,
      instructions,
    };
  } catch {
    return undefined;
  }
}
