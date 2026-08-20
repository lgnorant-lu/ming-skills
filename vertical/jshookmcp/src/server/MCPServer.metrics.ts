/**
 * MCPServer.metrics — Execution metrics collection utilities
 *
 * Pure functions for capturing server-side execution metrics (CPU, memory, timing).
 * Used by MCPServer.execution for E2E performance testing.
 */

export interface ExecutionMetricMemorySnapshot {
  source: 'server';
  rssBytes: number;
  privateBytes: null;
  virtualBytes: null;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
}

export interface ExecutionMetricPayload {
  source: 'server';
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  timeoutMs: number;
  serverPid: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  memoryBefore: ExecutionMetricMemorySnapshot;
  memoryAfter: ExecutionMetricMemorySnapshot;
  memoryDelta: {
    rssBytes: number;
    privateBytes: null;
    virtualBytes: null;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
}

/**
 * Returns true if execution metrics should be collected.
 * Enabled via E2E_COLLECT_PERFORMANCE=1 environment variable.
 */
export function shouldCollectExecutionMetrics(): boolean {
  return process.env.E2E_COLLECT_PERFORMANCE === '1';
}

/**
 * Captures a point-in-time memory snapshot from process.memoryUsage().
 */
export function captureExecutionMetricMemory(): ExecutionMetricMemorySnapshot {
  const memory = process.memoryUsage();
  return {
    source: 'server',
    rssBytes: memory.rss,
    privateBytes: null,
    virtualBytes: null,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  };
}

/**
 * Builds a complete execution metrics payload from start/end measurements.
 */
export function buildExecutionMetrics(
  startedAt: string,
  startTime: number,
  timeoutMs: number,
  cpuStart: NodeJS.CpuUsage,
  memoryBefore: ExecutionMetricMemorySnapshot,
): ExecutionMetricPayload {
  const finishedAt = new Date().toISOString();
  const cpuUsage = process.cpuUsage(cpuStart);
  const memoryAfter = captureExecutionMetricMemory();
  return {
    source: 'server',
    startedAt,
    finishedAt,
    elapsedMs: Number((performance.now() - startTime).toFixed(2)),
    timeoutMs,
    serverPid: process.pid,
    cpuUserMicros: cpuUsage.user,
    cpuSystemMicros: cpuUsage.system,
    memoryBefore,
    memoryAfter,
    memoryDelta: {
      rssBytes: memoryAfter.rssBytes - memoryBefore.rssBytes,
      privateBytes: null,
      virtualBytes: null,
      heapUsedBytes: memoryAfter.heapUsedBytes - memoryBefore.heapUsedBytes,
      heapTotalBytes: memoryAfter.heapTotalBytes - memoryBefore.heapTotalBytes,
      externalBytes: memoryAfter.externalBytes - memoryBefore.externalBytes,
      arrayBuffersBytes: memoryAfter.arrayBuffersBytes - memoryBefore.arrayBuffersBytes,
    },
  };
}

/**
 * Appends execution metrics to a tool response by embedding them in the first text content.
 * Returns the response unchanged if it cannot be enriched (non-JSON text, no text content, etc.).
 */
export function appendExecutionMetrics<T extends { content?: unknown[] }>(
  response: T,
  metrics: ExecutionMetricPayload,
): T {
  const content = response.content;
  if (!Array.isArray(content)) return response;

  const firstText = content.find(
    (entry: unknown): entry is { type: string; text: string } =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>).type === 'text' &&
      typeof (entry as Record<string, unknown>).text === 'string',
  );
  if (!firstText) return response;

  try {
    const parsed = JSON.parse(firstText.text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return response;
    }
    const record = parsed as Record<string, unknown>;
    if (!('_executionMetrics' in record)) {
      record._executionMetrics = metrics;
      firstText.text = JSON.stringify(record);
    }
  } catch {
    return response;
  }

  return response;
}
