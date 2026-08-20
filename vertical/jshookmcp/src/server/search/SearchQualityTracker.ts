import { RingBuffer } from '@utils/RingBuffer';

export interface SearchQueryRecord {
  id: string;
  query: string;
  timestamp: number;
  returnedTools: string[];
  returnedScores: number[];
  latencyMs: number;
  usedTool?: string;
  usedToolRank?: number;
}

export interface SearchQualityMetrics {
  totalQueries: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
  toolUsedRate: number;
  avgUsedRank: number;
  mrr: number;
  topKDistribution: Record<string, number>;
}

let recordCounter = 0;

function generateId(): string {
  return `sq-${Date.now()}-${++recordCounter}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export class SearchQualityTracker {
  private readonly MAX_HISTORY = 1000;
  private readonly records = new RingBuffer<SearchQueryRecord>(this.MAX_HISTORY);
  private lastRecordId: string | undefined;

  recordSearch(
    query: string,
    returnedTools: string[],
    returnedScores: number[],
    latencyMs: number,
  ): string {
    const id = generateId();
    const record: SearchQueryRecord = {
      id,
      query,
      timestamp: Date.now(),
      returnedTools,
      returnedScores,
      latencyMs,
    };
    this.records.push(record);
    this.lastRecordId = id;
    return id;
  }

  recordToolUsed(recordId: string, toolName: string): void {
    const arr = this.records.toArray();
    for (let i = arr.length - 1; i >= 0; i--) {
      const record = arr[i]!;
      if (record.id === recordId) {
        record.usedTool = toolName;
        const rank = record.returnedTools.indexOf(toolName);
        record.usedToolRank = rank >= 0 ? rank + 1 : undefined;
        return;
      }
    }
  }

  associateLastSearch(toolName: string): void {
    if (!this.lastRecordId) return;
    const arr = this.records.toArray();
    for (let i = arr.length - 1; i >= 0; i--) {
      const record = arr[i]!;
      if (record.id === this.lastRecordId) {
        const rank = record.returnedTools.indexOf(toolName);
        if (rank >= 0) {
          record.usedTool = toolName;
          record.usedToolRank = rank + 1;
        }
        return;
      }
    }
  }

  computeMetrics(): SearchQualityMetrics {
    const arr = this.records.toArray();
    const totalQueries = arr.length;

    if (totalQueries === 0) {
      return {
        totalQueries: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p99LatencyMs: 0,
        toolUsedRate: 0,
        avgUsedRank: 0,
        mrr: 0,
        topKDistribution: {},
      };
    }

    const latencies = arr.map((r) => r.latencyMs).toSorted((a, b) => a - b);
    const totalLatency = latencies.reduce((sum, v) => sum + v, 0);

    const usedRecords = arr.filter((r) => r.usedTool !== undefined);
    const toolUsedRate = usedRecords.length / totalQueries;

    let avgUsedRank = 0;
    let mrr = 0;
    const topKDistribution: Record<string, number> = {};

    if (usedRecords.length > 0) {
      let rankSum = 0;
      let reciprocalSum = 0;
      for (const record of usedRecords) {
        const rank = record.usedToolRank;
        if (rank !== undefined && rank > 0) {
          rankSum += rank;
          reciprocalSum += 1 / rank;
          const key = String(rank);
          topKDistribution[key] = (topKDistribution[key] ?? 0) + 1;
        }
      }
      avgUsedRank = rankSum / usedRecords.length;
      mrr = reciprocalSum / usedRecords.length;
    }

    return {
      totalQueries,
      avgLatencyMs: totalLatency / totalQueries,
      p50LatencyMs: percentile(latencies, 50),
      p99LatencyMs: percentile(latencies, 99),
      toolUsedRate,
      avgUsedRank,
      mrr,
      topKDistribution,
    };
  }

  getRecentRecords(limit = 10): SearchQueryRecord[] {
    const arr = this.records.toArray();
    return arr.slice(-limit);
  }

  getStats(): SearchQualityMetrics {
    return this.computeMetrics();
  }

  getEnhancementSuggestions(query: string, resultCount: number, topScore: number): string[] | null {
    if (resultCount >= 5 && topScore >= 0.5) return null;

    const suggestions: string[] = [];

    if (resultCount === 0) {
      suggestions.push(
        `No tools found for "${query}". Try broader terms or use search_tools with a different query.`,
      );
    } else if (resultCount < 3) {
      suggestions.push(
        `Only ${resultCount} tools found. Consider using synonyms or breaking down the query.`,
      );
    }

    if (topScore < 0.3 && resultCount > 0) {
      suggestions.push(
        'Low relevance scores. Try more specific tool names or domain prefixes (e.g., "page_", "hook_", "network_").',
      );
    }

    return suggestions.length > 0 ? suggestions : null;
  }
}
