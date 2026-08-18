/**
 * Memory monitoring utilities for tracking resource usage and detecting leaks
 */

export interface MemoryUsage {
  rss: number; // Resident set size (total memory allocated)
  heapTotal: number; // Total heap memory allocated
  heapUsed: number; // Heap memory currently in use
  external: number; // Memory used by external V8 objects
  arrayBuffers: number; // Memory allocated for ArrayBuffers
}

export interface MemorySnapshot {
  timestamp: number;
  usage: MemoryUsage;
  sessionId?: string | undefined;
  operation?: string | undefined;
}

export class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private readonly maxSnapshots = 100; // Keep last 100 snapshots
  private cleanupInterval?: NodeJS.Timeout | undefined;

  constructor() {
    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000); // Every 30 seconds
  }

  /**
   * Take a memory snapshot
   */
  takeSnapshot(sessionId?: string, operation?: string): MemorySnapshot {
    const usage = this.getCurrentMemoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      usage,
      sessionId,
      operation,
    };

    this.snapshots.push(snapshot);

    // Keep only recent snapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }

    return snapshot;
  }

  /**
   * Get current memory usage
   */
  getCurrentMemoryUsage(): MemoryUsage {
    const memUsage = process.memoryUsage();
    return {
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
    };
  }

  /**
   * Get memory usage for a specific session
   */
  getSessionMemoryUsage(sessionId: string): MemorySnapshot[] {
    return this.snapshots.filter((s) => s.sessionId === sessionId);
  }

  /**
   * Detect potential memory leaks by comparing memory usage over time
   */
  detectMemoryLeaks(): {
    isLeaking: boolean;
    trend: "increasing" | "stable" | "decreasing";
    growth: number; // MB/hour
    recommendation?: string | undefined;
  } {
    if (this.snapshots.length < 10) {
      return {
        isLeaking: false,
        trend: "stable",
        growth: 0,
        recommendation: "Insufficient data - need more snapshots",
      };
    }

    // Get last 10 snapshots
    const recent = this.snapshots.slice(-10);
    const oldest = recent[0];
    const newest = recent[recent.length - 1];

    if (!oldest || !newest) {
      return {
        isLeaking: false,
        trend: "stable",
        growth: 0,
      };
    }

    const timeDiff = (newest.timestamp - oldest.timestamp) / (1000 * 60 * 60); // hours
    const heapDiff =
      (newest.usage.heapUsed - oldest.usage.heapUsed) / (1024 * 1024); // MB

    const growthRate = timeDiff > 0 ? heapDiff / timeDiff : 0;

    let trend: "increasing" | "stable" | "decreasing" = "stable";
    if (growthRate > 5) {
      trend = "increasing";
    } else if (growthRate < -5) {
      trend = "decreasing";
    }

    const isLeaking = growthRate > 20; // More than 20MB/hour growth

    let recommendation: string | undefined;
    if (isLeaking) {
      recommendation =
        "Potential memory leak detected. Consider garbage collection or session cleanup.";
    } else if (growthRate > 10) {
      recommendation = "Memory usage increasing. Monitor for potential leaks.";
    }

    return {
      isLeaking,
      trend,
      growth: growthRate,
      recommendation,
    };
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): {
    current: MemoryUsage;
    peak: MemoryUsage;
    average: MemoryUsage;
    snapshotCount: number;
  } {
    const current = this.getCurrentMemoryUsage();

    if (this.snapshots.length === 0) {
      return {
        current,
        peak: current,
        average: current,
        snapshotCount: 0,
      };
    }

    const peak = this.snapshots.reduce(
      (max, snapshot) => ({
        rss: Math.max(max.rss, snapshot.usage.rss),
        heapTotal: Math.max(max.heapTotal, snapshot.usage.heapTotal),
        heapUsed: Math.max(max.heapUsed, snapshot.usage.heapUsed),
        external: Math.max(max.external, snapshot.usage.external),
        arrayBuffers: Math.max(max.arrayBuffers, snapshot.usage.arrayBuffers),
      }),
      { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }
    );

    const sum = this.snapshots.reduce(
      (acc, snapshot) => ({
        rss: acc.rss + snapshot.usage.rss,
        heapTotal: acc.heapTotal + snapshot.usage.heapTotal,
        heapUsed: acc.heapUsed + snapshot.usage.heapUsed,
        external: acc.external + snapshot.usage.external,
        arrayBuffers: acc.arrayBuffers + snapshot.usage.arrayBuffers,
      }),
      { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }
    );

    const count = this.snapshots.length;
    const average = {
      rss: sum.rss / count,
      heapTotal: sum.heapTotal / count,
      heapUsed: sum.heapUsed / count,
      external: sum.external / count,
      arrayBuffers: sum.arrayBuffers / count,
    };

    return {
      current,
      peak,
      average,
      snapshotCount: count,
    };
  }

  /**
   * Force garbage collection if available
   */
  forceGarbageCollection(): boolean {
    if (typeof global.gc === "function") {
      global.gc();
      return true;
    }
    return false;
  }

  /**
   * Clean up old snapshots and perform maintenance
   */
  private cleanup(): void {
    // Remove snapshots older than 1 hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.snapshots = this.snapshots.filter((s) => s.timestamp > oneHourAgo);
  }

  /**
   * Shutdown the memory monitor
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.snapshots = [];
  }

  /**
   * Format memory size in human-readable format
   */
  static formatMemorySize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

// Global memory monitor instance
export const memoryMonitor = new MemoryMonitor();

// Graceful shutdown
process.on("SIGINT", () => memoryMonitor.shutdown());
process.on("SIGTERM", () => memoryMonitor.shutdown());
