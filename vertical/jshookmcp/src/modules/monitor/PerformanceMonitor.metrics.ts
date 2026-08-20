import type { CodeCollector } from '@modules/collector/CodeCollector';
import { evaluateWithTimeout } from '@modules/collector/PageController';
import { logger } from '@utils/logger';
import type {
  PerformanceMetrics,
  PerformanceTimelineEntry,
  LargestContentfulPaintEntryLike,
  LayoutShiftEntryLike,
  PerformanceWithMemory,
} from './PerformanceMonitor.types';

export async function getPerformanceMetrics(collector: CodeCollector): Promise<PerformanceMetrics> {
  const page = await collector.getActivePage();

  const metrics = (await evaluateWithTimeout(page, () => {
    const result: Partial<PerformanceMetrics> = {};

    const navTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navTiming) {
      result.domContentLoaded = navTiming.domContentLoadedEventEnd - navTiming.fetchStart;
      result.loadComplete = navTiming.loadEventEnd - navTiming.fetchStart;
      result.ttfb = navTiming.responseStart - navTiming.requestStart;
    }

    const paintEntries = performance.getEntriesByType('paint');
    const fcpEntry = paintEntries.find((entry) => entry.name === 'first-contentful-paint');
    if (fcpEntry) {
      result.fcp = fcpEntry.startTime;
    }

    const lcpEntries = performance.getEntriesByType(
      'largest-contentful-paint',
    ) as LargestContentfulPaintEntryLike[];
    const lastLCP = lcpEntries.at(-1);
    if (lastLCP) {
      result.lcp = lastLCP.renderTime || lastLCP.loadTime;
    }

    let clsValue = 0;
    const layoutShiftEntries = performance.getEntriesByType(
      'layout-shift',
    ) as LayoutShiftEntryLike[];
    for (const entry of layoutShiftEntries) {
      if (!entry.hadRecentInput) {
        clsValue += entry.value ?? 0;
      }
    }
    result.cls = clsValue;

    const performanceWithMemory = performance as PerformanceWithMemory;
    if (performanceWithMemory.memory) {
      const memory = performanceWithMemory.memory;
      result.jsHeapSizeLimit = memory.jsHeapSizeLimit;
      result.totalJSHeapSize = memory.totalJSHeapSize;
      result.usedJSHeapSize = memory.usedJSHeapSize;
    }

    return result as PerformanceMetrics;
  })) as PerformanceMetrics;

  logger.info('Performance metrics collected', {
    fcp: metrics.fcp,
    lcp: metrics.lcp,
    cls: metrics.cls,
  });

  return metrics;
}

export async function getPerformanceTimeline(
  collector: CodeCollector,
): Promise<PerformanceTimelineEntry[]> {
  const page = await collector.getActivePage();

  const timeline = await evaluateWithTimeout(page, () => {
    return performance.getEntries().map((entry) => ({
      name: entry.name,
      entryType: entry.entryType,
      startTime: entry.startTime,
      duration: entry.duration,
    }));
  });

  logger.info(`Performance timeline collected: ${timeline.length} entries`);
  return timeline;
}
