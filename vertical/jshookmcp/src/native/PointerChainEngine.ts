/**
 * Pointer Chain Engine — multi-level BFS pointer scanning.
 *
 * Finds stable pointer chains: [base_module+offset] → [+off1] → [+off2] → ... → target
 * Supports chain validation, resolution, and persistence.
 *
 * Uses PlatformMemoryAPI for cross-platform memory operations.
 *
 * @module PointerChainEngine
 */

import { randomUUID } from 'node:crypto';
import {
  POINTER_CHAIN_DEFAULT_ALIGNMENT,
  POINTER_CHAIN_MAX_BFS_BREADTH,
  POINTER_CHAIN_MAX_DEPTH,
  POINTER_CHAIN_MAX_MATCHES,
  POINTER_CHAIN_MAX_OFFSET,
  POINTER_CHAIN_MAX_RESULTS,
  POINTER_CHAIN_SCAN_CHUNK_SIZE,
  USERSPACE_MAX_ADDRESS,
} from '@src/constants';
import type {
  PointerChain,
  PointerChainLink,
  PointerScanOptions,
  PointerScanResult,
  ChainValidationResult,
} from './PointerChainEngine.types';
import { createPlatformProvider } from './platform/factory.js';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import type { ProcessHandle } from './platform/types.js';
import { nativeMemoryManager } from './NativeMemoryManager.impl';
import { formatAddress, parseAddress } from './formatAddress';

interface ModuleEntry {
  name: string;
  base: bigint;
  size: number;
}

interface LevelMatch {
  /** Address where the pointer was found */
  pointerAddress: bigint;
  /** The value at pointerAddress (what it points to) */
  pointsTo: bigint;
  /** Offset: pointsTo - targetAddress for this level */
  offset: number;
}

export class PointerChainEngine {
  private providerCache: PlatformMemoryAPI | null = null;

  private get provider(): PlatformMemoryAPI {
    if (!this.providerCache) {
      this.providerCache = createPlatformProvider();
    }
    return this.providerCache;
  }

  private set provider(value: PlatformMemoryAPI | null) {
    this.providerCache = value;
  }

  /**
   * Multi-level BFS pointer scan.
   *
   * Algorithm:
   * Level 0: Find pointers P where *P ∈ [target - maxOffset, target + maxOffset]
   * Level 1: Find pointers Q where *Q ∈ [P - maxOffset, P + maxOffset] for each P
   * ... repeat up to maxDepth
   * Construct chains backward from target to base.
   */
  async scan(
    pid: number,
    targetAddress: string,
    options?: PointerScanOptions,
  ): Promise<PointerScanResult> {
    const start = performance.now();
    const maxDepth = Math.min(options?.maxDepth ?? 4, POINTER_CHAIN_MAX_DEPTH);
    const maxOffset = options?.maxOffset ?? POINTER_CHAIN_MAX_OFFSET;
    const maxResults = options?.maxResults ?? POINTER_CHAIN_MAX_RESULTS;
    const alignment = options?.alignment ?? POINTER_CHAIN_DEFAULT_ALIGNMENT;
    const staticOnly = options?.staticOnly ?? false;

    const targetAddr = parseAddress(targetAddress);

    const handle = this.provider.openProcess(pid, false);
    try {
      const modules = await this.getModuleMap(pid);

      // BFS: level by level
      // levelResults[i] = matches found at level i
      // levelResults[0] = pointers that point to target ±maxOffset
      const levelResults: LevelMatch[][] = [];

      // Targets for current level: addresses we're looking for pointers TO
      let currentTargets = new Set<bigint>([targetAddr]);

      for (let depth = 0; depth < maxDepth; depth++) {
        if (currentTargets.size === 0) break;

        const matches = this.scanLevel(
          handle,
          currentTargets,
          maxOffset,
          alignment,
          options?.modules ? { modules: options.modules } : undefined,
        );

        if (matches.length === 0) break;

        levelResults.push(matches);

        // Build next-level targets from found pointer addresses
        currentTargets = new Set<bigint>();
        for (const m of matches) {
          currentTargets.add(m.pointerAddress);
          if (currentTargets.size > POINTER_CHAIN_MAX_BFS_BREADTH) break; // limit BFS breadth
        }
      }

      // Construct chains: walk from deepest level back to target
      const chains = this.buildChains(levelResults, targetAddr, modules, maxResults, staticOnly);

      const elapsed = `${(performance.now() - start).toFixed(1)}ms`;

      return {
        pid,
        targetAddress: formatAddress(targetAddr),
        chains,
        totalFound: chains.length,
        maxDepth,
        elapsed,
      };
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Validate a pointer chain by re-dereferencing each link.
   */
  async validateChain(pid: number, chain: PointerChain): Promise<ChainValidationResult> {
    const handle = this.provider.openProcess(pid, false);
    try {
      const resolved = this.resolveChainInternal(handle, chain);
      if (resolved.brokenAt !== undefined) {
        return {
          chainId: chain.id,
          isValid: false,
          resolvedAddress: null,
          expectedAddress: chain.targetAddress,
          brokenAt: resolved.brokenAt,
        };
      }

      const expectedAddr = parseAddress(chain.targetAddress);
      const isValid = resolved.currentAddr === expectedAddr;

      return {
        chainId: chain.id,
        isValid,
        resolvedAddress: formatAddress(resolved.currentAddr),
        expectedAddress: chain.targetAddress,
        brokenAt: isValid ? undefined : chain.links.length - 1,
      };
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Validate multiple chains in batch.
   */
  async validateChains(pid: number, chains: PointerChain[]): Promise<ChainValidationResult[]> {
    const results: ChainValidationResult[] = [];
    for (const chain of chains) {
      results.push(await this.validateChain(pid, chain));
    }
    return results;
  }

  /**
   * Resolve a pointer chain to its current target address.
   */
  async resolveChain(pid: number, chain: PointerChain): Promise<string | null> {
    const handle = this.provider.openProcess(pid, false);
    try {
      const resolved = this.resolveChainInternal(handle, chain);
      return resolved.brokenAt === undefined ? formatAddress(resolved.currentAddr) : null;
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Walk a chain link-by-link, dereferencing each pointer. Returns the final
   * address plus the index of the first link whose read failed (undefined when
   * the whole chain resolved). Shared by {@link validateChain} and
   * {@link resolveChain} — previously two verbatim copies of this loop.
   */
  private resolveChainInternal(
    handle: ProcessHandle,
    chain: PointerChain,
  ): { currentAddr: bigint; brokenAt?: number } {
    let currentAddr = parseAddress(chain.baseAddress);

    for (let i = 0; i < chain.links.length; i++) {
      const link = chain.links[i]!;
      let ptrValue: bigint;
      try {
        const buf = this.provider.readMemory(handle, currentAddr, 8).data;
        ptrValue = buf.readBigUInt64LE(0);
      } catch {
        return { currentAddr, brokenAt: i };
      }
      currentAddr = ptrValue + BigInt(link.offset);
    }

    return { currentAddr };
  }

  /**
   * Export chains to JSON for persistence.
   */
  exportChains(chains: PointerChain[]): string {
    return JSON.stringify(chains, null, 2);
  }

  /**
   * Import chains from JSON.
   */
  importChains(data: string): PointerChain[] {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) throw new Error('Invalid chain data: expected array');
    return parsed as PointerChain[];
  }

  // ── Private Helpers ──

  /**
   * Get module info map for resolving module-relative addresses.
   */
  private async getModuleMap(pid: number): Promise<Map<string, ModuleEntry>> {
    const modules = new Map<string, ModuleEntry>();
    try {
      const result = await nativeMemoryManager.enumerateModules(pid);
      if (result.success && result.modules) {
        for (const mod of result.modules) {
          const base = parseAddress(mod.baseAddress);
          modules.set(mod.name.toLowerCase(), { name: mod.name, base, size: mod.size });
        }
      }
    } catch {
      // Module enumeration failed — proceed without module info
    }
    return modules;
  }

  /**
   * Resolve an address to module+offset notation.
   */
  private resolveToModule(
    address: bigint,
    moduleMap: Map<string, ModuleEntry>,
  ): { module: string; offset: number } | null {
    for (const entry of moduleMap.values()) {
      if (address >= entry.base && address < entry.base + BigInt(entry.size)) {
        return {
          module: entry.name,
          offset: Number(address - entry.base),
        };
      }
    }
    return null;
  }

  /**
   * BFS scan for one level: find all addresses whose pointer-sized value
   * points within ±maxOffset of any target address.
   */
  private scanLevel(
    handle: ProcessHandle,
    targetAddresses: Set<bigint>,
    maxOffset: number,
    alignment: number,
    _filter?: { modules?: string[] },
  ): LevelMatch[] {
    const matches: LevelMatch[] = [];
    const chunkSize = POINTER_CHAIN_SCAN_CHUNK_SIZE;

    // Build sorted target list for O(log n) binary search per pointer
    const targets = Array.from(targetAddresses).toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (targets.length === 0) return matches;

    // Compute global target range for fast pre-filter
    const maxOffsetBig = BigInt(maxOffset);
    const globalMin = targets[0]! - maxOffsetBig;
    const globalMax = targets[targets.length - 1]! + maxOffsetBig;

    let address = 0n;
    const maxAddress = USERSPACE_MAX_ADDRESS;

    while (address < maxAddress) {
      const regionInfo = this.provider.queryRegion(handle, address);
      if (!regionInfo) break;

      const regionSize = regionInfo.size;

      if (regionInfo.isReadable && regionSize > 0 && regionSize <= Number.MAX_SAFE_INTEGER) {
        const regionBase = regionInfo.baseAddress;

        for (
          let offset = 0;
          offset < regionSize && matches.length < POINTER_CHAIN_MAX_MATCHES;
          offset += chunkSize
        ) {
          const readSize = Math.min(chunkSize, regionSize - offset);
          const chunkAddr = regionBase + BigInt(offset);

          let chunk: Buffer;
          try {
            chunk = this.provider.readMemory(handle, chunkAddr, readSize).data;
          } catch {
            break;
          }

          // Scan for pointer-sized values that fall within target range
          for (let i = 0; i <= chunk.length - 8; i += alignment) {
            const ptrValue = chunk.readBigUInt64LE(i);

            // Fast pre-filter: check global range
            if (ptrValue < globalMin || ptrValue > globalMax) continue;

            // Binary search: find first target >= (ptrValue - maxOffset)
            const searchMin = ptrValue - maxOffsetBig;
            const searchMax = ptrValue + maxOffsetBig;
            let lo = 0;
            let hi = targets.length;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (targets[mid]! < searchMin) lo = mid + 1;
              else hi = mid;
            }

            // Check targets in range [searchMin, searchMax]
            for (let t = lo; t < targets.length && targets[t]! <= searchMax; t++) {
              const target = targets[t]!;
              const diff =
                ptrValue > target ? Number(ptrValue - target) : Number(target - ptrValue);

              if (diff <= maxOffset) {
                const pointerAddr = chunkAddr + BigInt(i);
                const matchOffset = Number(target - ptrValue);

                matches.push({
                  pointerAddress: pointerAddr,
                  pointsTo: ptrValue,
                  offset: matchOffset,
                });
                break; // One match per pointer address
              }
            }
          }
        }
      }

      address = regionInfo.baseAddress + BigInt(regionInfo.size);
    }

    return matches;
  }

  /**
   * Build pointer chains from level results (backward: deepest level = base).
   *
   * For a chain rooted at level `d`, every intermediate level must appear as a
   * link: [match@d] → [match@d-1] → … → [match@0] → target. Links are resolved
   * by walking backward from the root match, finding the previous level's match
   * whose pointerAddress lies within ±maxOffset of the current match's pointsTo.
   */
  private buildChains(
    levelResults: LevelMatch[][],
    targetAddr: bigint,
    modules: Map<string, ModuleEntry>,
    maxResults: number,
    staticOnly: boolean,
  ): PointerChain[] {
    if (levelResults.length === 0) return [];

    const chains: PointerChain[] = [];
    const targetAddrStr = formatAddress(targetAddr);
    const maxOff = BigInt(POINTER_CHAIN_MAX_OFFSET);

    // Pre-index every level by pointerAddress for O(1) backward lookups.
    const levelIndex = levelResults.map((level) => {
      const index = new Map<bigint, LevelMatch>();
      for (const m of level) index.set(m.pointerAddress, m);
      return index;
    });

    /** Find the previous level's match whose pointerAddress ≈ pointsTo (±maxOffset). */
    const findPrevMatch = (levelIdx: number, pointsTo: bigint): LevelMatch | undefined => {
      const exact = levelIndex[levelIdx]!.get(pointsTo);
      if (exact) return exact;
      for (const pm of levelResults[levelIdx]!) {
        const diff =
          pointsTo > pm.pointerAddress
            ? pointsTo - pm.pointerAddress
            : pm.pointerAddress - pointsTo;
        if (diff <= maxOff) return pm;
      }
      return undefined;
    };

    // For each depth, create chains
    // Single level: direct pointer → target
    for (let depth = 0; depth < levelResults.length && chains.length < maxResults; depth++) {
      const level = levelResults[depth]!;

      if (depth === 0) {
        // Direct pointers to target
        for (const match of level) {
          if (chains.length >= maxResults) break;

          const baseAddrStr = formatAddress(match.pointerAddress);
          const modInfo = this.resolveToModule(match.pointerAddress, modules);
          const isStatic = modInfo !== null;

          if (staticOnly && !isStatic) continue;

          const link: PointerChainLink = {
            address: baseAddrStr,
            module: modInfo?.module,
            moduleOffset: modInfo?.offset,
            offset: match.offset,
          };

          chains.push({
            id: randomUUID(),
            links: [link],
            targetAddress: targetAddrStr,
            baseAddress: baseAddrStr,
            isStatic,
            depth: 1,
            lastValidated: Date.now(),
            isValid: true,
          });
        }
      } else {
        // Multi-level: walk backward from the root match (level `depth`) down
        // to level 0, emitting one link per level — a depth-3 chain has 3 links.
        for (const match of level) {
          if (chains.length >= maxResults) break;

          const modInfo = this.resolveToModule(match.pointerAddress, modules);
          const isStatic = modInfo !== null;

          if (staticOnly && !isStatic) continue;

          const links: PointerChainLink[] = [];
          let cur = match;
          let prev: LevelMatch | undefined;
          let linked = true;

          for (let lvl = depth; lvl >= 1; lvl--) {
            prev = findPrevMatch(lvl - 1, cur.pointsTo);
            if (!prev) {
              linked = false; // chain broken at this level — drop the candidate
              break;
            }
            const isRoot = lvl === depth;
            links.push({
              address: formatAddress(cur.pointerAddress),
              module: isRoot ? modInfo?.module : undefined,
              moduleOffset: isRoot ? modInfo?.offset : undefined,
              // Dereferencing cur yields cur.pointsTo; adding this offset lands
              // exactly on prev's pointerAddress.
              offset: Number(prev.pointerAddress - cur.pointsTo),
            });
            cur = prev;
          }

          if (!linked || !prev) continue;

          // Final link: level 0's offset is relative to the target address.
          links.push({
            address: formatAddress(prev.pointerAddress),
            offset: prev.offset,
          });

          const baseAddrStr = formatAddress(match.pointerAddress);
          chains.push({
            id: randomUUID(),
            links,
            targetAddress: targetAddrStr,
            baseAddress: baseAddrStr,
            isStatic,
            depth: links.length,
            lastValidated: Date.now(),
            isValid: true,
          });
        }
      }
    }

    // Sort: static chains first, then by depth (shorter preferred)
    chains.sort((a, b) => {
      if (a.isStatic !== b.isStatic) return a.isStatic ? -1 : 1;
      return a.depth - b.depth;
    });

    return chains.slice(0, maxResults);
  }
}

export const pointerChainEngine = new PointerChainEngine();
