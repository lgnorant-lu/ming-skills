import type { CDPSession, Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { logger } from '@utils/logger';
import { CDP_SESSION_TIMEOUT_MS } from '@src/constants';
import type {
  PerformanceMetrics,
  PerformanceTimelineEntry,
  CoverageInfo,
  CPUProfile,
} from './PerformanceMonitor.types';
import { getPerformanceMetrics, getPerformanceTimeline } from './PerformanceMonitor.metrics';
import { startCoverage, stopCoverage } from './PerformanceMonitor.coverage';
import {
  startCPUProfiling,
  stopCPUProfiling,
  startHeapSampling,
  stopHeapSampling,
} from './PerformanceMonitor.profiling';
import { startTracing, stopTracing } from './PerformanceMonitor.tracing';
import { takeHeapSnapshot } from './PerformanceMonitor.snapshot';

async function PING(cdp: CDPSession): Promise<void> {
  await Promise.race([
    cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('cdp_unreachable')), CDP_SESSION_TIMEOUT_MS),
    ),
  ]);
}

export class PerformanceMonitor {
  private cdpSession: CDPSession | null = null;
  private coverageEnabled = false;
  private profilerEnabled = false;
  private tracingEnabled = false;
  private heapSamplingEnabled = false;
  private coveragePage: Page | null = null;
  private tracingPage: Page | null = null;

  constructor(private collector: CodeCollector) {}

  private async ensureCDPSession(): Promise<CDPSession> {
    if (!this.cdpSession) {
      const page = await this.collector.getActivePage();
      // Wrap session creation so a hanging createCDPSession() cannot block.
      this.cdpSession = await Promise.race([
        page.createCDPSession() as Promise<CDPSession>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('cdp_session_timeout')), CDP_SESSION_TIMEOUT_MS),
        ),
      ]);
      return this.cdpSession;
    }

    // Pre-flight: verify the existing CDP session is still responsive.
    // After debugger pause/resume, the session may be in a zombie state where
    // send() hangs indefinitely without firing 'disconnected'.
    try {
      await PING(this.cdpSession);
      return this.cdpSession;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'cdp_unreachable') throw err;
      logger.warn('PerformanceMonitor CDP session unresponsive, recreating...');
      try {
        await this.cdpSession.detach();
      } catch {
        /* ignore */
      }
      this.cdpSession = null;
      const page = await this.collector.getActivePage();
      this.cdpSession = await Promise.race([
        page.createCDPSession() as Promise<CDPSession>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('cdp_session_timeout')), CDP_SESSION_TIMEOUT_MS),
        ),
      ]);
      return this.cdpSession;
    }
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    return getPerformanceMetrics(this.collector);
  }

  async getPerformanceTimeline(): Promise<PerformanceTimelineEntry[]> {
    return getPerformanceTimeline(this.collector);
  }

  async startCoverage(options?: {
    resetOnNavigation?: boolean;
    reportAnonymousScripts?: boolean;
  }): Promise<void> {
    const result = await startCoverage(this.collector, options);
    this.coverageEnabled = result.coverageEnabled;
    this.coveragePage = result.coveragePage;
  }

  async stopCoverage(): Promise<CoverageInfo[]> {
    const result = await stopCoverage(this.collector, this.coveragePage, this.coverageEnabled);
    this.coverageEnabled = false;
    this.coveragePage = null;
    return result;
  }

  async startCPUProfiling(): Promise<void> {
    const cdp = await this.ensureCDPSession();
    const result = await startCPUProfiling(cdp);
    this.profilerEnabled = result.profilerEnabled;
  }

  async stopCPUProfiling(): Promise<CPUProfile> {
    const cdp = await this.ensureCDPSession();
    const result = await stopCPUProfiling(cdp, this.profilerEnabled);
    this.profilerEnabled = false;
    return result;
  }

  async takeHeapSnapshot(): Promise<number> {
    const cdp = await this.ensureCDPSession();
    return takeHeapSnapshot(cdp);
  }

  async startTracing(options?: { categories?: string[]; screenshots?: boolean }): Promise<void> {
    const result = await startTracing(this.collector, this.tracingEnabled, options);
    this.tracingEnabled = result.tracingEnabled;
    this.tracingPage = result.tracingPage;
  }

  async stopTracing(options?: {
    artifactPath?: string;
  }): Promise<{ artifactPath?: string; eventCount: number; sizeBytes: number }> {
    const result = await stopTracing(
      this.collector,
      this.tracingPage,
      this.tracingEnabled,
      options,
    );
    this.tracingEnabled = false;
    this.tracingPage = null;
    return result;
  }

  async startHeapSampling(options?: { samplingInterval?: number }): Promise<void> {
    const cdp = await this.ensureCDPSession();
    const result = await startHeapSampling(cdp, this.heapSamplingEnabled, options);
    this.heapSamplingEnabled = result.heapSamplingEnabled;
  }

  async stopHeapSampling(options?: { artifactPath?: string; topN?: number }): Promise<{
    artifactPath?: string;
    sampleCount: number;
    topAllocations: Array<{ functionName: string; url: string; selfSize: number }>;
  }> {
    const cdp = await this.ensureCDPSession();
    const result = await stopHeapSampling(cdp, this.heapSamplingEnabled, options);
    this.heapSamplingEnabled = false;
    return result;
  }

  async close(): Promise<void> {
    if (this.cdpSession) {
      if (this.coverageEnabled) {
        await this.stopCoverage().catch(() => {});
      }
      if (this.profilerEnabled) {
        await this.stopCPUProfiling().catch(() => {});
      }
      if (this.tracingEnabled) {
        await this.stopTracing().catch(() => {});
      }
      if (this.heapSamplingEnabled) {
        await this.stopHeapSampling().catch(() => {});
      }
      await this.cdpSession.detach();
      this.cdpSession = null;
    }
    logger.info('PerformanceMonitor closed');
  }
}
