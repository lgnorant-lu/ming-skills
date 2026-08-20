/**
 * A/B comparison: No-rerank vs Old hardcoded vs New tuned rerank strategies.
 * Usage: npx tsx scripts/search-tune/compare-rerank.ts
 */
/* eslint-disable unicorn/consistent-function-scoping */

// ── Old hardcoded rerank (pre-tuning values from code) ──
const OLD = {
  MAINTENANCE_PENALTY: 0.1,
  STATELESS_INTERACTIVE_PENALTY: 0.35,
  STATELESS_CORE_PENALTY: 0.2,
  STATELESS_COMPUTE_BOOST: 1.6,
  STATELESS_SPECIFIC_TOOL_BOOST: 1.25,
  BROWSER_LAUNCH_BOOST: 1.4,
  BROWSER_ATTACH_BOOST: 1.2,
  NETWORK_MONITOR_BOOST: 1.35,
  NETWORK_GET_REQUESTS_BOOST: 1.5,
};

async function main() {
  const { initRegistry } = await import('../../src/server/registry/index');
  await initRegistry();

  const { ToolSearchEngine } = await import('../../src/server/search/ToolSearchEngineImpl');
  const { buildSearchQualityFixture } =
    await import('../../tests/server/search/fixtures/search-quality.fixture');
  const { isBrowserOrNetworkTask, isMaintenanceTask, isStatelessComputeTask } =
    await import('../../src/server/ToolRouter.intent');

  const fixture = buildSearchQualityFixture();
  const fixtureEngine = new ToolSearchEngine(
    [...fixture.tools],
    fixture.domainByToolName,
    undefined,
    undefined,
    undefined,
  );

  // Use full registry engine for rerank-specific tests (needs browser/network/maintenance tools)
  const { getAllManifests } = await import('../../src/server/registry/index');
  const allTools: any[] = [];
  const domainMap = new Map<string, string>();
  for (const m of getAllManifests()) {
    for (const r of m.registrations) {
      allTools.push(r.tool);
      domainMap.set(r.tool.name, m.domain);
    }
  }
  const fullEngine = new ToolSearchEngine(allTools, domainMap, undefined, undefined, undefined);

  // ── Eval helpers ──
  interface CaseMetrics {
    reciprocalRankAt10: number;
    ndcgAt10: number;
    hitAt1: 0 | 1;
    hitAt3: 0 | 1;
    hitAt5: 0 | 1;
  }
  interface EvalCase {
    query: string;
    topK: number;
    expectations: readonly { tool: string; gain: number }[];
  }

  function evaluate(results: readonly { name: string }[], tc: EvalCase): CaseMetrics {
    const topK = results.slice(0, 10);
    const relevantSet = new Set(tc.expectations.filter((e) => e.gain >= 2).map((e) => e.tool));
    let firstRelevantRank: number | null = null;
    for (let i = 0; i < topK.length; i++) {
      if (relevantSet.has(topK[i]!.name)) {
        firstRelevantRank = i;
        break;
      }
    }
    const rr = firstRelevantRank !== null ? 1 / (firstRelevantRank + 1) : 0;
    const gainMap = new Map(tc.expectations.map((e) => [e.tool, e.gain]));
    let dcg = 0;
    for (let i = 0; i < topK.length && i < 10; i++)
      dcg += (gainMap.get(topK[i]!.name) ?? 0) / Math.log2(i + 2);
    const sg = [...gainMap.values()].toSorted((a, b) => b - a);
    let idcg = 0;
    for (let i = 0; i < sg.length && i < 10; i++) idcg += sg[i]! / Math.log2(i + 2);
    return {
      reciprocalRankAt10: rr,
      ndcgAt10: idcg > 0 ? dcg / idcg : 0,
      hitAt1: topK.slice(0, 1).some((r) => relevantSet.has(r.name)) ? 1 : 0,
      hitAt3: topK.slice(0, 3).some((r) => relevantSet.has(r.name)) ? 1 : 0,
      hitAt5: topK.slice(0, 5).some((r) => relevantSet.has(r.name)) ? 1 : 0,
    };
  }
  function summary(cms: CaseMetrics[]) {
    const n = cms.length || 1;
    const mrr = cms.reduce((s, m) => s + m.reciprocalRankAt10, 0) / n;
    return {
      mrrAt10: mrr,
      ndcgAt10: cms.reduce((s, m) => s + m.ndcgAt10, 0) / n,
      pAt1: cms.reduce((s, m) => s + m.hitAt1, 0) / n,
      pAt3: cms.reduce((s, m) => s + m.hitAt3, 0) / n,
      pAt5: cms.reduce((s, m) => s + m.hitAt5, 0) / n,
      score:
        0.45 * mrr +
        0.25 * (cms.reduce((s, m) => s + m.ndcgAt10, 0) / n) +
        0.15 * (cms.reduce((s, m) => s + m.hitAt1, 0) / n) +
        0.15 * (cms.reduce((s, m) => s + m.hitAt3, 0) / n),
    };
  }
  function printLine(label: string, s: ReturnType<typeof summary>) {
    console.log(
      `${label.padEnd(19)}│ ${s.mrrAt10.toFixed(3)} │ ${s.ndcgAt10.toFixed(3)} │ ${s.pAt1.toFixed(3)} │ ${s.pAt3.toFixed(3)} │ ${s.score.toFixed(4)}`,
    );
  }

  // ── Rerank factories ──
  type Reranker = (results: any[], task: string, workflow: any | null, state: any) => any[];

  function rerankFactory(mults: typeof OLD): Reranker {
    return (results, task, workflow, state) => {
      const bnt = isBrowserOrNetworkTask(task, workflow);
      const mt = isMaintenanceTask(task);
      const sc = isStatelessComputeTask(task);
      return results
        .map((r: any) => {
          let s = r.score;
          if (bnt && !mt && r.domain === 'maintenance') s *= mults.MAINTENANCE_PENALTY;
          if (sc) {
            if (['browser', 'network', 'debugger', 'hooks', 'maintenance'].includes(r.domain))
              s *= mults.STATELESS_INTERACTIVE_PENALTY;
            if (['core', 'streaming', 'workflow'].includes(r.domain))
              s *= mults.STATELESS_CORE_PENALTY;
            if (
              ['encoding', 'transform', 'protocol-analysis', 'sourcemap', 'core'].includes(r.domain)
            )
              s *= mults.STATELESS_COMPUTE_BOOST;
            if (
              [
                'binary_detect_format',
                'binary_decode',
                'crypto_test_harness',
                'ast_transform_apply',
                'proto_auto_detect',
                'proto_infer_fields',
                'proto_infer_state_machine',
                'proto_fingerprint',
              ].includes(r.name)
            )
              s *= mults.STATELESS_SPECIFIC_TOOL_BOOST;
          }
          if (bnt) {
            if (!state.hasActivePage && r.name === 'browser_launch')
              s *= mults.BROWSER_LAUNCH_BOOST;
            if (!state.hasActivePage && r.name === 'browser_attach')
              s *= mults.BROWSER_ATTACH_BOOST;
            if (state.hasActivePage && !state.networkEnabled && r.name === 'network_monitor')
              s *= mults.NETWORK_MONITOR_BOOST;
            if (
              state.hasActivePage &&
              state.networkEnabled &&
              state.capturedRequestCount > 0 &&
              r.name === 'network_get_requests'
            )
              s *= mults.NETWORK_GET_REQUESTS_BOOST;
          }
          return { ...r, score: s };
        })
        .toSorted((a: any, b: any) => b.score - a.score);
    };
  }

  const {
    RERANK_MAINTENANCE_PENALTY,
    RERANK_STATELESS_INTERACTIVE_PENALTY,
    RERANK_STATELESS_CORE_PENALTY,
    RERANK_STATELESS_COMPUTE_BOOST,
    RERANK_STATELESS_SPECIFIC_TOOL_BOOST,
    RERANK_BROWSER_LAUNCH_BOOST,
    RERANK_BROWSER_ATTACH_BOOST,
    RERANK_NETWORK_MONITOR_BOOST,
    RERANK_NETWORK_GET_REQUESTS_BOOST,
  } = await import('../../src/constants');

  const NEW_VALS = {
    MAINTENANCE_PENALTY: RERANK_MAINTENANCE_PENALTY,
    STATELESS_INTERACTIVE_PENALTY: RERANK_STATELESS_INTERACTIVE_PENALTY,
    STATELESS_CORE_PENALTY: RERANK_STATELESS_CORE_PENALTY,
    STATELESS_COMPUTE_BOOST: RERANK_STATELESS_COMPUTE_BOOST,
    STATELESS_SPECIFIC_TOOL_BOOST: RERANK_STATELESS_SPECIFIC_TOOL_BOOST,
    BROWSER_LAUNCH_BOOST: RERANK_BROWSER_LAUNCH_BOOST,
    BROWSER_ATTACH_BOOST: RERANK_BROWSER_ATTACH_BOOST,
    NETWORK_MONITOR_BOOST: RERANK_NETWORK_MONITOR_BOOST,
    NETWORK_GET_REQUESTS_BOOST: RERANK_NETWORK_GET_REQUESTS_BOOST,
  };

  const strategies: [string, Reranker][] = [
    ['No rerank', (r) => r],
    ['Old hardcoded', rerankFactory(OLD)],
    ['New tuned', rerankFactory(NEW_VALS)],
  ];

  // ═══════════════════════════════════════════════════════
  // Dataset 1: search-quality (lexical) — no runtime state
  // ═══════════════════════════════════════════════════════
  const baseState = { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 };
  console.log('═══ Dataset 1: search-quality (lexical, state: no browser) ═══');
  console.log('Strategy           │ MRR@10 │ NDCG@10│ P@1   │ P@3   │ Score ');
  console.log('───────────────────┼────────┼────────┼───────┼───────┼───────');
  for (const [label, reranker] of strategies) {
    const cms: CaseMetrics[] = [];
    for (const tc of fixture.cases) {
      const results = await fixtureEngine.search(tc.query, tc.topK);
      cms.push(evaluate(reranker(results, tc.query, null, baseState), tc));
    }
    printLine(label, summary(cms));
  }

  // ═══════════════════════════════════════════════════════
  // Dataset 2: profile-tier — no runtime state
  // ═══════════════════════════════════════════════════════
  const profileCases = [
    {
      id: 'p-search-tls',
      query: 'call tls_keylog_enable',
      topK: 10,
      expectations: [{ tool: 'tls_keylog_enable', gain: 3 }],
    },
    {
      id: 'p-search-frida',
      query: 'attach Frida to process',
      topK: 10,
      expectations: [{ tool: 'frida_attach', gain: 3 }],
    },
    {
      id: 'p-search-browser',
      query: 'navigate to URL and click',
      topK: 10,
      expectations: [
        { tool: 'page_navigate', gain: 3 },
        { tool: 'page_click', gain: 3 },
      ],
    },
    {
      id: 'p-workflow-v8',
      query: 'extract V8 bytecode',
      topK: 10,
      expectations: [{ tool: 'v8_bytecode_extract', gain: 3 }],
    },
    {
      id: 'p-workflow-net',
      query: 'capture network requests',
      topK: 10,
      expectations: [{ tool: 'network_enable', gain: 3 }],
    },
    {
      id: 'p-workflow-syscall',
      query: 'call syscall_start_monitor',
      topK: 10,
      expectations: [{ tool: 'syscall_start_monitor', gain: 3 }],
    },
    {
      id: 'p-search-generic',
      query: 'debug JavaScript code',
      topK: 10,
      expectations: [{ tool: 'debug_pause', gain: 2 }],
    },
  ];

  console.log('\n═══ Dataset 2: profile-tier (state: no browser) ═══');
  console.log('Strategy           │ MRR@10 │ NDCG@10│ P@1   │ P@3   │ Score ');
  console.log('───────────────────┼────────┼────────┼───────┼───────┼───────');
  for (const [label, reranker] of strategies) {
    const cms: CaseMetrics[] = [];
    for (const tc of profileCases) {
      const results = await fixtureEngine.search(tc.query, tc.topK);
      cms.push(evaluate(reranker(results, tc.query, null, baseState), tc as any));
    }
    printLine(label, summary(cms));
  }

  // ═══════════════════════════════════════════════════════
  // Dataset 3: Rerank-specific — varies runtime state
  // ═══════════════════════════════════════════════════════
  console.log('\n═══ Dataset 3: Rerank-specific (full registry, varying state) ═══');

  // Case 3a: Browser launch boost — no active page
  {
    const state = { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 };
    const cases: EvalCase[] = [
      {
        query: 'open browser for automation',
        topK: 10,
        expectations: [{ tool: 'browser_launch', gain: 3 }],
      },
      {
        query: 'start browser and attach',
        topK: 10,
        expectations: [
          { tool: 'browser_launch', gain: 3 },
          { tool: 'browser_attach', gain: 3 },
        ],
      },
      {
        query: 'launch chrome to analyze page',
        topK: 10,
        expectations: [{ tool: 'browser_launch', gain: 3 }],
      },
    ];
    console.log('\n  [3a] Browser launch boost (hasActivePage=false)');
    console.log('  State: no browser active → should boost browser_launch/attach');
    console.log('  Strategy           │ MRR@10 │ NDCG@10│ P@1   │ P@3   │ Score ');
    console.log('  ───────────────────┼────────┼────────┼───────┼───────┼───────');
    for (const [label, reranker] of strategies) {
      const cms: CaseMetrics[] = [];
      for (const tc of cases) {
        const results = await fullEngine.search(tc.query, tc.topK);
        cms.push(evaluate(reranker(results, tc.query, null, state), tc));
      }
      printLine('  ' + label, summary(cms));
    }
  }

  // Case 3b: Network monitor boost — active page but no network
  {
    const state = { hasActivePage: true, networkEnabled: false, capturedRequestCount: 0 };
    const cases: EvalCase[] = [
      {
        query: 'monitor network traffic',
        topK: 10,
        expectations: [{ tool: 'network_monitor', gain: 3 }],
      },
      {
        query: 'enable network capture',
        topK: 10,
        expectations: [{ tool: 'network_enable', gain: 3 }],
      },
    ];
    console.log('\n  [3b] Network monitor boost (hasActivePage, !networkEnabled)');
    console.log('  State: browser active, no network → should boost network_monitor');
    console.log('  Strategy           │ MRR@10 │ NDCG@10│ P@1   │ P@3   │ Score ');
    console.log('  ───────────────────┼────────┼────────┼───────┼───────┼───────');
    for (const [label, reranker] of strategies) {
      const cms: CaseMetrics[] = [];
      for (const tc of cases) {
        const results = await fullEngine.search(tc.query, tc.topK);
        cms.push(evaluate(reranker(results, tc.query, null, state), tc));
      }
      printLine('  ' + label, summary(cms));
    }
  }

  // Case 3c: network_get_requests boost — has network + captured requests
  {
    const state = { hasActivePage: true, networkEnabled: true, capturedRequestCount: 5 };
    const cases: EvalCase[] = [
      {
        query: 'get captured requests',
        topK: 10,
        expectations: [{ tool: 'network_get_requests', gain: 3 }],
      },
    ];
    console.log('\n  [3c] network_get_requests boost (hasPage, netEnabled, requests>0)');
    console.log('  State: browser+network active, 5 captured → should boost network_get_requests');
    console.log('  Strategy           │ MRR@10 │ NDCG@10│ P@1   │ P@3   │ Score ');
    console.log('  ───────────────────┼────────┼────────┼───────┼───────┼───────');
    for (const [label, reranker] of strategies) {
      const cms: CaseMetrics[] = [];
      for (const tc of cases) {
        const results = await fullEngine.search(tc.query, tc.topK);
        cms.push(evaluate(reranker(results, tc.query, null, state), tc));
      }
      printLine('  ' + label, summary(cms));
    }
  }

  // Case 3d: Stateless compute rerank
  {
    const state = { hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 };
    const cases: EvalCase[] = [
      {
        query: 'decode base64 payload',
        topK: 10,
        expectations: [{ tool: 'binary_decode', gain: 3 }],
      },
      {
        query: 'detect encoding format of bytes',
        topK: 10,
        expectations: [{ tool: 'binary_detect_format', gain: 3 }],
      },
    ];
    console.log('\n  [3d] Stateless compute (no browser)');
    console.log('  State: no browser → should boost compute tools, penalize interactive');
    console.log('  Strategy           │ MRR@10 │ NDCG@10│ P@1   │ P@3   │ Score ');
    console.log('  ───────────────────┼────────┼────────┼───────┼───────┼───────');
    for (const [label, reranker] of strategies) {
      const cms: CaseMetrics[] = [];
      for (const tc of cases) {
        const results = await fullEngine.search(tc.query, tc.topK);
        cms.push(evaluate(reranker(results, tc.query, null, state), tc));
      }
      printLine('  ' + label, summary(cms));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
