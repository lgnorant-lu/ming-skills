/**
 * DartAotLoader — Load and parse Dart AOT snapshots from APK or libapp.so.
 *
 * Orchestrates:
 *  1. APK extraction (if apkPath provided) → libapp.so bytes
 *  2. Snapshot header parsing
 *  3. Cluster extraction (Code, ObjectPool, Instructions)
 *  4. ObjectPool registry population
 *  5. Code object enumeration
 *
 * This is the **loading layer** that prepares a snapshot for execution.
 * The execution layer (DartAotExecutor) consumes this loader's output.
 */

import { extractArm64Libs } from '../apk';
import { ElfLoader } from '../ElfLoader';
import { ToolError } from '@errors/ToolError';
import { DART_ISOLATE_SNAPSHOT_SYMBOLS } from '@modules/dart-inspector/snapshot-types';
import {
  parseSnapshotHeader,
  extractCodeObjects,
  type SnapshotHeader,
  type DartCode,
  type Cluster,
  parseCluster,
} from './SnapshotParser';
import { ObjectPool, ObjectPoolRegistry } from './ObjectPool';

/** Loaded Dart AOT snapshot with all parsed structures. */
export interface LoadedSnapshot {
  /** Snapshot header. */
  header: SnapshotHeader;
  /** All clusters in the snapshot. */
  clusters: Cluster[];
  /** All Code objects (compiled Dart functions). */
  codeObjects: DartCode[];
  /** ObjectPool registry (address → ObjectPool). */
  objectPools: Array<{ address: bigint; pool: ObjectPool }>;
  /** Raw snapshot bytes. */
  rawBytes: Uint8Array;
}

export class DartAotLoader {
  /**
   * Load a Dart AOT snapshot from an APK or libapp.so file.
   *
   * @param path - Absolute path to APK (extracts arm64-v8a/libapp.so) or libapp.so directly
   * @returns Parsed snapshot ready for execution
   */
  async loadSnapshot(path: string): Promise<LoadedSnapshot> {
    // Determine if this is an APK or direct libapp.so
    const isApk = path.toLowerCase().endsWith('.apk');

    let libappBytes: Uint8Array;

    if (isApk) {
      // Extract libapp.so from APK
      const libs = await extractArm64Libs(path);
      const libapp = libs.find((lib) => lib.name.toLowerCase() === 'libapp.so');

      if (!libapp) {
        throw new ToolError('NOT_FOUND', 'libapp.so not found in APK arm64-v8a libs', {
          details: { apkPath: path, foundLibs: libs.map((l) => l.name) },
        });
      }

      libappBytes = libapp.bytes;
    } else {
      // Read libapp.so directly
      const fs = await import('node:fs/promises');
      const buffer = await fs.readFile(path);
      libappBytes = new Uint8Array(buffer);
    }

    const snapshotBytes = extractSnapshotPayload(libappBytes);

    // Parse snapshot header
    const header = parseSnapshotHeader(snapshotBytes);

    // Extract all clusters
    const clusters: Cluster[] = [];
    let currentOffset = header.dataStartOffset;

    for (let i = 0; i < header.numClusters; i++) {
      if (Number(currentOffset) >= snapshotBytes.length) break;

      try {
        const { cluster, nextOffset } = parseCluster(snapshotBytes, currentOffset);
        clusters.push(cluster);
        currentOffset = nextOffset;
      } catch (error) {
        // Graceful termination on cluster parse error (corrupted snapshot or unsupported format)
        console.warn(`[DartAotLoader] Cluster ${i} parse failed:`, error);
        break;
      }
    }

    // Extract Code objects
    const codeObjects = extractCodeObjects(snapshotBytes);

    // Build ObjectPool registry
    const objectPools: Array<{ address: bigint; pool: ObjectPool }> = [];
    const poolRegistry = new ObjectPoolRegistry();

    for (const cluster of clusters) {
      if (cluster.type === 'ObjectPool') {
        for (const obj of cluster.objects) {
          try {
            const pool = new ObjectPool(obj.data, obj.offset);
            poolRegistry.register(obj.offset, obj.data);
            objectPools.push({ address: obj.offset, pool });
          } catch (error) {
            console.warn(
              `[DartAotLoader] ObjectPool at 0x${obj.offset.toString(16)} parse failed:`,
              error,
            );
          }
        }
      }
    }

    return {
      header,
      clusters,
      codeObjects,
      objectPools,
      rawBytes: snapshotBytes,
    };
  }

  /**
   * Find a Code object by name.
   * Returns undefined if not found.
   */
  findCodeByName(snapshot: LoadedSnapshot, name: string): DartCode | undefined {
    return snapshot.codeObjects.find((code) => code.name === name);
  }

  /**
   * Find a Code object by entry point address.
   * Returns undefined if not found.
   */
  findCodeByAddress(snapshot: LoadedSnapshot, address: bigint): DartCode | undefined {
    return snapshot.codeObjects.find((code) => code.entryPoint === address);
  }

  /**
   * Get ObjectPool at a specific address.
   * Returns undefined if not found.
   */
  getObjectPool(snapshot: LoadedSnapshot, address: bigint): ObjectPool | undefined {
    const entry = snapshot.objectPools.find((p) => p.address === address);
    return entry?.pool;
  }
}

function extractSnapshotPayload(bytes: Uint8Array): Uint8Array {
  const isElf = bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
  if (!isElf) return bytes;

  const elf = new ElfLoader(bytes);
  for (const symbol of DART_ISOLATE_SNAPSHOT_SYMBOLS) {
    const offset = elf.symbolFileOffset(symbol);
    if (offset !== undefined) return bytes.subarray(offset);
  }
  throw new Error(
    `ELF does not expose ${DART_ISOLATE_SNAPSHOT_SYMBOLS.join(' or ')}; snapshot location is ambiguous`,
  );
}
