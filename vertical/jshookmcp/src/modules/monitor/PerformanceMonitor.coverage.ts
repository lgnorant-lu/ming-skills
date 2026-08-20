import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { logger } from '@utils/logger';
import type { CoverageInfo } from './PerformanceMonitor.types';

// Import coverage methods from PageController
// These are mocked in tests/setup.ts
import {
  coverageStartJSWithTimeout,
  coverageStartCSSWithTimeout,
  coverageStopJSWithTimeout,
  coverageStopCSSWithTimeout,
} from '@modules/collector/PageController';

export async function startCoverage(
  collector: CodeCollector,
  options?: {
    resetOnNavigation?: boolean;
    reportAnonymousScripts?: boolean;
  },
): Promise<{ coverageEnabled: true; coveragePage: Page }> {
  const page = await collector.getActivePage();
  await Promise.all([
    coverageStartJSWithTimeout(page, {
      resetOnNavigation: options?.resetOnNavigation,
      reportAnonymousScripts: options?.reportAnonymousScripts,
    }),
    coverageStartCSSWithTimeout(page, {
      resetOnNavigation: options?.resetOnNavigation,
    }),
  ]);

  logger.info('Code coverage collection started');
  return { coverageEnabled: true, coveragePage: page };
}

export async function stopCoverage(
  collector: CodeCollector,
  coveragePage: Page | null,
  coverageEnabled: boolean,
): Promise<CoverageInfo[]> {
  if (!coverageEnabled) {
    throw new PrerequisiteError('Coverage not enabled. Call startCoverage() first.');
  }

  const page = coveragePage ?? (await collector.getActivePage());
  const [jsCoverageResult, cssCoverageResult] = await Promise.all([
    coverageStopJSWithTimeout(page),
    coverageStopCSSWithTimeout(page),
  ]);

  const jsCoverage = jsCoverageResult as Array<{
    text: string;
    url: string;
    ranges: Array<{ start: number; end: number }>;
  }>;
  const cssCoverage = cssCoverageResult as Array<{
    text: string;
    url: string;
    ranges: Array<{ start: number; end: number }>;
  }>;

  const coverageEntries = [...jsCoverage, ...cssCoverage];
  const coverageInfo: CoverageInfo[] = coverageEntries.map((entry) => {
    const totalBytes = entry.text.length;
    const usedBytes = entry.ranges.reduce((sum, range) => sum + (range.end - range.start), 0);

    return {
      url: entry.url,
      text: entry.text,
      ranges: entry.ranges.map((range) => ({
        start: range.start,
        end: range.end,
        count: 1,
      })),
      totalBytes,
      usedBytes,
      coveragePercentage: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    };
  });

  logger.success(`Code coverage collected: ${coverageInfo.length} scripts`, {
    totalScripts: coverageInfo.length,
    avgCoverage:
      coverageInfo.reduce((sum, info) => sum + info.coveragePercentage, 0) / coverageInfo.length,
  });

  return coverageInfo;
}
