import { performance } from 'node:perf_hooks';
import { DEFAULT_SEARCH_CONFIG } from '../../src/config/search-defaults';
import { DEFAULT_SEARCH_VECTOR_MODEL_ID } from '../../src/constants/search-model';
import { SEARCH_VECTOR_BM25_SKIP_THRESHOLD } from '../../src/constants/search';
import { ToolSearchEngine } from '../../src/server/search/ToolSearchEngineImpl';
import { loadSearchCatalog } from '../../src/server/registry/SearchCatalog';
import { buildSearchQualityFixture } from '../../tests/server/search/fixtures/search-quality.fixture';
import type { SearchEvalCase } from '../../tests/server/search/fixtures/search-quality.fixture';
import { aggregateSearchMetrics, evaluateCase, summarizeFailedCases } from './metrics';

const SEMANTIC_CASES = [
  {
    id: 'semantic-navigate',
    title: 'Open a web address',
    query: 'open a web address',
    topK: 10,
    expectations: [{ tool: 'page_navigate', gain: 3 }],
    idealTool: 'page_navigate',
    tags: ['browser'],
  },
  {
    id: 'semantic-click',
    title: 'Press an element on screen',
    query: 'press an element on screen',
    topK: 10,
    expectations: [{ tool: 'page_click', gain: 3 }],
    idealTool: 'page_click',
    tags: ['browser'],
  },
  {
    id: 'semantic-screenshot',
    title: 'Save the current viewport as an image',
    query: 'save the current viewport as an image',
    topK: 10,
    expectations: [{ tool: 'page_screenshot', gain: 3 }],
    idealTool: 'page_screenshot',
    tags: ['browser'],
  },
  {
    id: 'semantic-network-observe',
    title: 'Observe backend communication',
    query: 'observe outgoing backend communication',
    topK: 10,
    expectations: [
      { tool: 'network_monitor', gain: 3 },
      { tool: 'network_enable', gain: 2 },
    ],
    tags: ['network'],
  },
  {
    id: 'semantic-network-credentials',
    title: 'Recover credentials from captured traffic',
    query: 'recover credentials from captured traffic',
    topK: 10,
    expectations: [{ tool: 'network_extract_auth', gain: 3 }],
    idealTool: 'network_extract_auth',
    tags: ['network'],
  },
  {
    id: 'semantic-debug-pause',
    title: 'Suspend the JavaScript runtime',
    query: 'suspend the JavaScript runtime',
    topK: 10,
    expectations: [{ tool: 'debugger_pause', gain: 3 }],
    idealTool: 'debugger_pause',
    tags: ['debugger'],
  },
  {
    id: 'semantic-tls-secrets',
    title: 'Inspect TLS session secrets',
    query: 'inspect encrypted transport session secrets',
    topK: 10,
    expectations: [{ tool: 'tls_keylog_enable', gain: 3 }],
    idealTool: 'tls_keylog_enable',
    tags: ['boringssl'],
  },
  {
    id: 'semantic-jadx',
    title: 'Turn an Android package into source code',
    query: 'turn an Android package into readable source code',
    topK: 10,
    expectations: [{ tool: 'jadx_decompile', gain: 3 }],
    idealTool: 'jadx_decompile',
    tags: ['binary-instrument'],
  },
  {
    id: 'semantic-syscalls',
    title: 'Listen to operating system calls',
    query: 'listen to operating system calls made by a process',
    topK: 10,
    expectations: [{ tool: 'syscall_start_monitor', gain: 3 }],
    idealTool: 'syscall_start_monitor',
    tags: ['syscall-hook'],
  },
  {
    id: 'semantic-mojo',
    title: 'Examine Chromium interprocess messages',
    query: 'examine Chromium interprocess messages',
    topK: 10,
    expectations: [{ tool: 'mojo_messages_get', gain: 3 }],
    idealTool: 'mojo_messages_get',
    tags: ['mojo-ipc'],
  },
  {
    id: 'semantic-unpack',
    title: 'Restore bundled source',
    query: 'restore readable modules from a bundled minified script',
    topK: 10,
    expectations: [
      { tool: 'webcrack_unpack', gain: 3 },
      { tool: 'collect_code', gain: 2 },
    ],
    tags: ['analysis'],
  },
  {
    id: 'semantic-crypto',
    title: 'Locate encryption implementation',
    query: 'locate the implementation responsible for encryption',
    topK: 10,
    expectations: [{ tool: 'detect_crypto', gain: 3 }],
    idealTool: 'detect_crypto',
    tags: ['analysis'],
  },
] as const satisfies readonly SearchEvalCase[];

async function main(): Promise<void> {
  const requestedModel =
    process.argv
      .slice(2)
      .map((argument) => argument.trim())
      .find((argument) => argument.length > 0 && argument !== '--') ??
    DEFAULT_SEARCH_VECTOR_MODEL_ID;
  const vectorEnabled = requestedModel.toLowerCase() !== 'lexical';
  const catalog = await loadSearchCatalog();
  const fixture = buildSearchQualityFixture();
  const cases = fixture.cases.filter((testCase) =>
    testCase.expectations.some((expectation) => catalog.toolByName.has(expectation.tool)),
  );
  const skippedCaseIds = fixture.cases
    .filter((testCase) => !cases.includes(testCase))
    .map((testCase) => testCase.id);
  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);

  const engine = new ToolSearchEngine(
    [...catalog.tools],
    catalog.domainByToolName,
    undefined,
    undefined,
    {
      ...DEFAULT_SEARCH_CONFIG,
      vectorEnabled,
      vectorModelId: vectorEnabled ? requestedModel : DEFAULT_SEARCH_VECTOR_MODEL_ID,
      vectorDynamicWeight: false,
    },
    catalog.sceneKeywordsByToolName,
  );

  const indexStarted = performance.now();
  if (vectorEnabled) await engine.waitForEmbeddings();
  const indexMs = performance.now() - indexStarted;

  const metrics = [];
  const rankedResults = new Map();
  const queryStarted = performance.now();
  for (const testCase of cases) {
    const results = await engine.search(
      testCase.query,
      testCase.topK,
      undefined,
      testCase.visibleDomains ? new Set(testCase.visibleDomains) : undefined,
      testCase.profile,
    );
    rankedResults.set(testCase.id, results);
    metrics.push(evaluateCase(results, testCase));
  }
  const queryMs = performance.now() - queryStarted;

  const semanticMetrics = [];
  const semanticRankedResults = new Map();
  const semanticStarted = performance.now();
  for (const testCase of SEMANTIC_CASES) {
    const results = await engine.search(testCase.query, testCase.topK);
    semanticRankedResults.set(testCase.id, results);
    semanticMetrics.push(evaluateCase(results, testCase));
  }
  const semanticQueryMs = performance.now() - semanticStarted;
  clearInterval(sampler);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);

  const aggregate = aggregateSearchMetrics(metrics);
  const failures = summarizeFailedCases(rankedResults, cases);
  const semanticAggregate = aggregateSearchMetrics(semanticMetrics);
  const semanticFailures = summarizeFailedCases(semanticRankedResults, SEMANTIC_CASES);
  console.log(
    JSON.stringify(
      {
        model: vectorEnabled ? requestedModel : 'lexical',
        toolCount: catalog.tools.length,
        caseCount: cases.length,
        skippedCaseIds,
        vectorBm25SkipThreshold: SEARCH_VECTOR_BM25_SKIP_THRESHOLD,
        indexMs,
        queryMs,
        meanQueryMs: queryMs / cases.length,
        peakRssDeltaMb: (peakRss - rssBefore) / (1024 * 1024),
        ...aggregate,
        failures,
        semantic: {
          caseCount: SEMANTIC_CASES.length,
          queryMs: semanticQueryMs,
          meanQueryMs: semanticQueryMs / SEMANTIC_CASES.length,
          ...semanticAggregate,
          failures: semanticFailures,
        },
      },
      null,
      2,
    ),
  );
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
