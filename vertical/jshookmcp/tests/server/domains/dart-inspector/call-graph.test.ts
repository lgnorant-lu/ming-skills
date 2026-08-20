/**
 * Behavioural tests for the `dart_call_graph` tool.
 *
 * The graph builder runs against an in-memory mocked DartAotLoader snapshot
 * (no file IO) so every branch of the pool-entry → Code-entry matching can be
 * exercised deterministically: direct match, tag-stripped (−1) fallback,
 * self-edge exclusion, zero-value skip, maxEdges cap, poolsScanned/poolsMissing
 * accounting, entryPoints name filter, BL-based call target resolution, and
 * the no-path validation error.
 */
import { describe, expect, it, vi } from 'vitest';

const snapshotHolder = vi.hoisted(() => ({
  current: { codeObjects: [], objectPools: [], clusters: [] } as unknown,
}));

vi.mock('@modules/native-emulator/dart/DartAotLoader', () => ({
  DartAotLoader: class MockDartAotLoader {
    async loadSnapshot(_path: string) {
      return snapshotHolder.current as never;
    }
  },
}));

import manifest from '@server/domains/dart-inspector/manifest';
import type { MCPServerContext } from '@server/MCPServer.context';
import { R } from '@server/domains/shared/ResponseBuilder';

type Edge = { from: string; to: string; fromName?: string; toName?: string; resolved?: string };
type GraphPayload = {
  success: boolean;
  error?: string;
  nodes: Array<{ entry: string; name?: string; size: number; hasName: boolean }>;
  edges: Edge[];
  nodeCount: number;
  edgeCount: number;
  entryPoints: Array<{ entry: string; name?: string }>;
  poolsScanned: number;
  poolsMissing: number;
  blResolvedEdges: number;
  truncated: boolean;
  honestBoundary: string;
};

type PcDescriptorsPayload = {
  success: boolean;
  functions: Array<{
    totalDescriptors: number;
    callSites: number;
    descriptors: Array<{ kind: number; pcOffset: number }>;
  }>;
  totalDescriptors: number;
  truncated: boolean;
};

interface MockCode {
  name: string | undefined;
  entryPoint: bigint;
  objectPool: bigint;
  pcDescriptors: bigint;
  size: number;
  instructions: Uint8Array;
}
interface MockPool {
  address: bigint;
  pool: { getAllEntries: () => Array<{ value: bigint; type: string; offset: number }> };
}
interface MockClusterObj {
  offset: bigint;
  data: Uint8Array;
}
interface MockCluster {
  type: string;
  objects: MockClusterObj[];
}

/**
 * Encode ARM64 BL instruction: `0x94000000 | (imm26 & 0x03FFFFFF)`.
 * BL offset = (target - pc) / 4.
 */
function encodeBl(imm26: number): number {
  return (0x94000000 | (imm26 & 0x03ffffff)) >>> 0;
}

/** Build raw PcDescriptors binary with tagged header. */
function makePcDescData(
  entries: Array<{ pcOffset: number; kind?: number; deoptId?: number; tokenPos?: number }>,
): Uint8Array {
  const intsPerEntry = 5;
  const numElements = entries.length * intsPerEntry;
  const headerSize = 8; // Smi-tagged length
  const dataSize = headerSize + numElements * 4;
  const buf = new ArrayBuffer(dataSize);
  const view = new DataView(buf);
  // tagged Smi: (numElements * 2) + 1, 64-bit LE
  view.setBigUint64(0, BigInt(numElements * 2 + 1), true);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const base = headerSize + i * intsPerEntry * 4;
    view.setUint32(base, e.pcOffset, true);
    view.setInt32(base + 4, e.deoptId ?? 0, true);
    view.setInt32(base + 8, e.tokenPos ?? -1, true);
    view.setUint32(base + 12, 0, true);
    view.setUint32(base + 16, (e.kind ?? 1) & 0xff, true);
  }
  return new Uint8Array(buf);
}

function makeCode(
  name: string | undefined,
  entryPoint: bigint,
  objectPool: bigint,
  pcDescriptors?: bigint,
): MockCode {
  return {
    name,
    entryPoint,
    objectPool,
    pcDescriptors: pcDescriptors ?? 0x1000000n + entryPoint,
    size: 16,
    instructions: new Uint8Array(64),
  };
}
function makePool(address: bigint, values: bigint[]): MockPool {
  return {
    address,
    pool: {
      getAllEntries: () => values.map((value) => ({ value, type: 'immediate', offset: 0 })),
    },
  };
}
function setSnapshot(codes: MockCode[], pools: MockPool[], clusters?: MockCluster[]): void {
  snapshotHolder.current = {
    version: '1.0',
    numClusters: 0,
    dataStartOffset: 0,
    clusters: clusters ?? [],
    codeObjects: codes,
    objectPools: pools,
  };
}

async function callGraph(args: Record<string, unknown>): Promise<GraphPayload> {
  const handler = await manifest.ensure({} as MCPServerContext);
  const res = await handler.handleDartCallGraph(args);
  return R.parse<GraphPayload>(res);
}

async function loadPcDescriptors(args: Record<string, unknown>): Promise<PcDescriptorsPayload> {
  const handler = await manifest.ensure({} as MCPServerContext);
  const res = await handler.handleDartPcDescriptors(args);
  return R.parse<PcDescriptorsPayload>(res);
}

describe('dart_call_graph', () => {
  // ── Pool-based edges (existing) ──────────────────────────────────────

  it('builds a caller→callee edge from a pool entry matching another Code entry point', async () => {
    setSnapshot(
      [makeCode('main', 0x1000n, 0x5000n), makeCode('helper', 0x2000n, 0x6000n)],
      [makePool(0x5000n, [0x2000n])],
    );
    const p = await callGraph({ libappPath: '/fake/libapp.so' });
    expect(p.success).toBe(true);
    expect(p.nodeCount).toBe(2);
    expect(p.edgeCount).toBe(1);
    expect(p.edges[0]).toMatchObject({
      from: '0x1000',
      to: '0x2000',
      fromName: 'main',
      toName: 'helper',
      resolved: 'pool',
    });
    expect(p.blResolvedEdges).toBe(0);
  });

  it('matches the tag-stripped (value−1) entry when the raw value is not a known entry', async () => {
    setSnapshot(
      [makeCode('a', 0x1000n, 0x5000n), makeCode('b', 0x2000n, 0x6000n)],
      [makePool(0x5000n, [0x2001n])],
    );
    const p = await callGraph({ libappPath: '/x' });
    expect(p.edgeCount).toBe(1);
    expect(p.edges[0]?.to).toBe('0x2000');
    expect(p.edges[0]?.resolved).toBe('pool');
  });

  it('excludes self-edges (a Code whose pool points at its own entry)', async () => {
    setSnapshot([makeCode('a', 0x1000n, 0x5000n)], [makePool(0x5000n, [0x1000n])]);
    const p = await callGraph({ libappPath: '/x' });
    expect(p.edgeCount).toBe(0);
  });

  it('skips zero-value pool entries', async () => {
    setSnapshot(
      [makeCode('a', 0x1000n, 0x5000n), makeCode('b', 0x2000n, 0x6000n)],
      [makePool(0x5000n, [0n, 0x2000n])],
    );
    const p = await callGraph({ libappPath: '/x' });
    expect(p.edgeCount).toBe(1);
    expect(p.edges[0]?.to).toBe('0x2000');
  });

  it('truncates at maxEdges and sets truncated=true', async () => {
    setSnapshot(
      [
        makeCode('a', 0x1000n, 0x5000n),
        makeCode('b', 0x2000n, 0x6000n),
        makeCode('c', 0x3000n, 0x7000n),
      ],
      [makePool(0x5000n, [0x2000n, 0x3000n])],
    );
    const p = await callGraph({ libappPath: '/x', maxEdges: 1 });
    expect(p.truncated).toBe(true);
    expect(p.edgeCount).toBe(1);
  });

  it('accounts poolsScanned vs poolsMissing', async () => {
    setSnapshot(
      [makeCode('a', 0x1000n, 0x5000n), makeCode('b', 0x2000n, 0x9999n)],
      [makePool(0x5000n, [0x2000n])],
    );
    const p = await callGraph({ libappPath: '/x' });
    expect(p.poolsScanned).toBe(1);
    expect(p.poolsMissing).toBe(1);
  });

  it('filters entryPoints by main|entry name and emits an honestBoundary string', async () => {
    setSnapshot([makeCode('main', 0x1000n, 0x5000n), makeCode('helper', 0x2000n, 0x6000n)], []);
    const p = await callGraph({ libappPath: '/x' });
    expect(p.entryPoints.map((e) => e.name)).toEqual(['main']);
    expect(typeof p.honestBoundary).toBe('string');
    expect(p.honestBoundary.length).toBeGreaterThan(0);
  });

  it('surfaces a validation error when neither apkPath nor libappPath is given', async () => {
    const p = await callGraph({});
    expect(p.success).toBe(false);
    expect(p.error).toBeDefined();
  });

  // ── BL-based resolution edges ────────────────────────────────────────

  it('resolves a BL edge from PcDescriptors call-site PC offset', async () => {
    // main @ 0x1000, helper @ 0x2000
    // main's code section has a BL instruction at offset 0x04 that calls 0x2000
    // BL target = 0x2000, PC = 0x1004 => imm26 = (0x2000 - 0x1004) / 4 = 0xFFC / 4 = 0x3FF
    const mainCode = makeCode('main', 0x1000n, 0x5000n, 0x400000n);
    const helperCode = makeCode('helper', 0x2000n, 0x6000n, 0x500000n);

    const imm26 = (0x2000 - 0x1004) / 4;
    const blInsn = encodeBl(imm26);
    const instructions = new Uint8Array(64);
    instructions[4] = blInsn & 0xff;
    instructions[5] = (blInsn >>> 8) & 0xff;
    instructions[6] = (blInsn >>> 16) & 0xff;
    instructions[7] = (blInsn >>> 24) & 0xff;
    mainCode.instructions = instructions;

    const pcData = makePcDescData([{ pcOffset: 4, kind: 1 }]);

    setSnapshot(
      [mainCode, helperCode],
      [],
      [
        {
          type: 'PcDescriptors',
          objects: [{ offset: 0x400000n, data: pcData }],
        },
      ],
    );

    const p = await callGraph({ libappPath: '/x' });
    expect(p.blResolvedEdges).toBe(1);
    const blEdges = p.edges.filter((e) => e.resolved === 'bl');
    expect(blEdges).toHaveLength(1);
    expect(blEdges[0]).toMatchObject({
      from: '0x1000',
      to: '0x2000',
      fromName: 'main',
      toName: 'helper',
      resolved: 'bl',
    });
  });

  it('blResolvedEdges is zero when PcDescriptors clusters are absent', async () => {
    setSnapshot(
      [makeCode('main', 0x1000n, 0x5000n), makeCode('helper', 0x2000n, 0x6000n)],
      [makePool(0x5000n, [0x2000n])],
    );
    const p = await callGraph({ libappPath: '/x' });
    expect(p.blResolvedEdges).toBe(0);
    expect(p.edges.every((e) => e.resolved === 'pool')).toBe(true);
  });
});

describe('dart_pc_descriptors', () => {
  it('filters non-call descriptors and caps a single function at maxResults', async () => {
    const code = makeCode('main', 0x1000n, 0x5000n, 0x9000n);
    setSnapshot(
      [code],
      [],
      [
        {
          type: 'PcDescriptors',
          objects: [
            {
              offset: 0x9000n,
              data: makePcDescData([
                { pcOffset: 0, kind: 0 },
                { pcOffset: 4, kind: 1 },
                { pcOffset: 8, kind: 2 },
                { pcOffset: 12, kind: 3 },
              ]),
            },
          ],
        },
      ],
    );

    const payload = await loadPcDescriptors({
      libappPath: '/fake/libapp.so',
      callSitesOnly: true,
      resolveTargets: false,
      maxResults: 2,
    });

    expect(payload.success).toBe(true);
    expect(payload.totalDescriptors).toBe(2);
    expect(payload.truncated).toBe(true);
    expect(payload.functions[0]).toMatchObject({ totalDescriptors: 4, callSites: 2 });
    expect(payload.functions[0]!.descriptors.map((entry) => entry.kind)).toEqual([1, 2]);
  });
});
