import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argNumber, argBool } from '@server/domains/shared/parse-args';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { ensureDevice } from '@modules/webgpu/CDPIntegration';
import { computeFrameStats } from '@utils/FrameStats';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies } from '../types';

/**
 * Handler for webgpu_frame_timing tool.
 *
 * Measures per-frame CPU and GPU cost over a rAF loop:
 *  - CPU side: `performance.now` frame intervals.
 *  - GPU side: `timestamp-query` (createQuerySet + timestampWrites in the
 *    pass descriptor + resolveQuerySet after submit), converted with
 *    `device.limits.timestampPeriod` (ns per tick).
 *
 * When the device does not support the `timestamp-query` feature, GPU timings
 * are unavailable and the result degrades to CPU round-trip timing with
 * `precision: 'cpu-roundtrip'` (avgGpuMs/p95GpuMs null, bound unknown).
 *
 * Pattern reference: WebGPU Inspector frame timing and stats-gl's
 * rAF + timestamp-query loops.
 */
export class FrameTimingHandler {
  private deps: WebGPUDomainDependencies;
  private pageLockManager = getPageLockManager();

  constructor(_ctx: MCPServerContext, deps: WebGPUDomainDependencies) {
    this.deps = deps;
  }

  async handle(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const frameCount = argNumber(args, 'frameCount', 60);
      if (!Number.isInteger(frameCount) || frameCount <= 0) {
        throw new Error('Invalid frameCount: must be a positive integer');
      }
      const includeTimestamps = argBool(args, 'includeTimestamps', true);

      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      return await this.pageLockManager.withLock(pageId, async () => {
        // Reuse the cached adapter/device established by ensureDevice so the
        // timing loop shares the same adapter selection as other WebGPU tools.
        await ensureDevice(page);

        const raw = await page.evaluate(
          async ({ _frameCount }: { _frameCount: number }) => {
            const cache = (window as any).__webgpuDeviceCache;
            if (!cache || !cache.device) {
              throw new Error('WebGPU device cache unavailable. Call ensureDevice first.');
            }
            const device = cache.device;

            const features = device.features;
            const timestampSupported = features ? features.has('timestamp-query') : false;
            const timestampPeriod =
              device.limits && typeof device.limits.timestampPeriod === 'number'
                ? device.limits.timestampPeriod
                : 1;

            let querySet: any = null;
            if (timestampSupported) {
              querySet = device.createQuerySet({
                type: 'timestamp',
                count: _frameCount * 2,
              });
            }

            const frameTimesMs: number[] = [];
            const gpuTimesMs: number[] = [];
            let prevFrameStart: number | null = null;

            for (let i = 0; i < _frameCount; i++) {
              const frameStart = performance.now();
              await new Promise((resolve) => requestAnimationFrame(resolve));

              frameTimesMs.push(
                prevFrameStart !== null
                  ? performance.now() - prevFrameStart
                  : performance.now() - frameStart,
              );
              prevFrameStart = frameStart;

              if (querySet) {
                // A minimal pass whose begin/end timestamps bracket the GPU
                // work of this frame.
                const beginIdx = i * 2;
                const endIdx = i * 2 + 1;
                const encoder = device.createCommandEncoder();
                const pass = encoder.beginRenderPass({
                  colorAttachments: [],
                  timestampWrites: {
                    querySet,
                    beginningOfPassWriteIndex: beginIdx,
                    endOfPassWriteIndex: endIdx,
                  },
                });
                pass.end();
                device.queue.submit([encoder.finish()]);
                await device.queue.onSubmittedWorkDone();
              }
            }

            // Resolve timestamps into a mapped buffer and convert ticks → ns.
            if (querySet) {
              const dst = device.createBuffer({
                size: _frameCount * 2 * 8,
                usage:
                  ((globalThis as any).GPUBufferUsage?.COPY_DST || 0) |
                  ((globalThis as any).GPUBufferUsage?.MAP_READ || 0),
              });
              device.queue.resolveQuerySet(querySet, 0, _frameCount * 2, dst, 0);
              await device.queue.onSubmittedWorkDone();
              await dst.mapAsync((globalThis as any).GPUMapMode?.READ || 0);

              const arr = new BigUint64Array(dst.getMappedRange());
              for (let i = 0; i < _frameCount; i++) {
                const startTicks = Number(arr[i * 2] ?? 0n);
                const endTicks = Number(arr[i * 2 + 1] ?? 0n);
                const startNs = startTicks * timestampPeriod;
                const endNs = endTicks * timestampPeriod;
                gpuTimesMs.push(Math.max(0, endNs - startNs) / 1e6);
              }
              dst.destroy();
            }

            return {
              frameTimesMs,
              gpuTimesMs,
              timestampSupported,
              timestampPeriod,
            };
          },
          { _frameCount: frameCount },
        );

        const precision: 'gpu-timestamp' | 'cpu-roundtrip' = raw.timestampSupported
          ? 'gpu-timestamp'
          : 'cpu-roundtrip';

        const stats = computeFrameStats(raw.frameTimesMs, raw.gpuTimesMs, precision);

        if (includeTimestamps) {
          stats.frames = raw.frameTimesMs.map((frameMs: number, i: number) => ({
            frameIndex: i,
            frameMs,
            gpuMs: raw.gpuTimesMs[i] ?? null,
          }));
        }

        return stats;
      });
    });
  }

  private async getActivePage(): Promise<any> {
    if (!this.deps.pageController) {
      return null;
    }

    try {
      return await this.deps.pageController.getActivePage();
    } catch {
      return null;
    }
  }
}
