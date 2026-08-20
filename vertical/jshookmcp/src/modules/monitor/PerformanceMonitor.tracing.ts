import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { logger } from '@utils/logger';
import { cdpLimit } from '@utils/concurrency';
import { writeFile } from 'node:fs/promises';
import { resolveArtifactPath } from '@utils/artifacts';
import { countTraceEvents } from './PerformanceMonitor.types';

export async function startTracing(
  collector: CodeCollector,
  tracingEnabled: boolean,
  options?: { categories?: string[]; screenshots?: boolean },
): Promise<{ tracingEnabled: true; tracingPage: Page }> {
  return cdpLimit(async () => {
    if (tracingEnabled) {
      throw new Error('Tracing already in progress. Call stopTracing() first.');
    }

    const page = await collector.getActivePage();
    const categories = options?.categories ?? [
      '-*',
      'devtools.timeline',
      'v8.execute',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'toplevel',
      'blink.console',
      'blink.user_timing',
      'latencyInfo',
      ...(options?.screenshots ? ['disabled-by-default-devtools.screenshot'] : []),
    ];

    await page.tracing.start({
      categories,
      screenshots: options?.screenshots,
    });

    logger.info('Performance tracing started', { categories: categories.length });
    return { tracingEnabled: true, tracingPage: page };
  });
}

export async function stopTracing(
  collector: CodeCollector,
  tracingPage: Page | null,
  tracingEnabled: boolean,
  options?: {
    artifactPath?: string;
  },
): Promise<{ artifactPath?: string; eventCount: number; sizeBytes: number }> {
  return cdpLimit(async () => {
    if (!tracingEnabled) {
      throw new PrerequisiteError('Tracing not in progress. Call startTracing() first.');
    }

    const page = tracingPage ?? (await collector.getActivePage());
    const traceBuffer = await page.tracing.stop();
    const traceData = traceBuffer ? Buffer.from(traceBuffer).toString('utf-8') : '';

    // Counting markers is much cheaper than materializing a large trace JSON object.
    const eventCount = countTraceEvents(traceData);

    // Save to artifact file
    let savedPath: string | undefined;
    if (options?.artifactPath) {
      await writeFile(options.artifactPath, traceData, 'utf-8');
      savedPath = options.artifactPath;
    } else {
      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'traces',
        toolName: 'performance-trace',
        ext: 'json',
      });
      await writeFile(absolutePath, traceData, 'utf-8');
      savedPath = displayPath;
    }

    logger.success('Performance trace saved', {
      eventCount,
      sizeBytes: traceData.length,
      path: savedPath,
    });

    return {
      artifactPath: savedPath,
      eventCount,
      sizeBytes: traceData.length,
    };
  });
}
