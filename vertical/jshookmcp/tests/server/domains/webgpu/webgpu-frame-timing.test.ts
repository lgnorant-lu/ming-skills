/**
 * Fix 1 [P0] — webgpu_frame_timing tool.
 *
 * Pure statistics (`computeFrameStats`) are tested directly; the handler is
 * exercised with a mocked page whose evaluate resolves the in-page rAF +
 * timestamp-query script result.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';
// Pure statistics (computeFrameStats) are tested in tests/utils/FrameStats.test.ts.

// ─── Handler ─────────────────────────────────────────────────────────────────

describe('webgpu_frame_timing', () => {
  let ctx: MCPServerContext;
  let handlers: WebGPUHandlers;

  beforeEach(() => {
    ctx = {
      eventBus: { emit: () => {} },
      pageController: {
        getActivePage: async () => {
          throw new Error('No active page');
        },
      },
    } as unknown as MCPServerContext;
    handlers = new WebGPUHandlers(ctx);
  });

  it('should require an active page', async () => {
    const response = await handlers.webgpu_frame_timing({ frameCount: 60 });
    const result = ResponseBuilder.parse(response);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page/i),
    });
  });

  it('should validate frameCount bounds', async () => {
    const mockPage = {
      url: () => 'https://example.com/',
      evaluate: vi.fn().mockResolvedValue(undefined),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ metrics: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };
    ctx.pageController = { getActivePage: async () => mockPage } as any;
    handlers = new WebGPUHandlers(ctx);

    const response = await handlers.webgpu_frame_timing({ frameCount: 0 });
    const result = ResponseBuilder.parse(response);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/frameCount/i);
  });

  it('should return frame timing stats from GPU timestamp queries', async () => {
    const mockPage = {
      url: () => 'https://example.com/',
      evaluate: vi.fn().mockResolvedValue({
        frameTimesMs: [16, 17, 16, 16, 16, 16, 16, 16, 16, 16],
        gpuTimesMs: [8, 9, 8, 8, 8, 8, 8, 8, 8, 8],
        timestampSupported: true,
        timestampPeriod: 1,
      }),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ metrics: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };
    ctx.pageController = { getActivePage: async () => mockPage } as any;
    handlers = new WebGPUHandlers(ctx);

    const response = await handlers.webgpu_frame_timing({ frameCount: 10 });
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.precision).toBe('gpu-timestamp');
    expect(result.frameCount).toBe(10);
    expect(result.avgFrameMs).toBeGreaterThan(0);
    expect(result.avgGpuMs).toBeGreaterThan(0);
    expect(typeof result.p95FrameMs).toBe('number');
    expect(typeof result.droppedFrames).toBe('number');
    expect(['gpu-bound', 'cpu-bound', 'balanced', 'unknown']).toContain(result.cpuOrGpuBound);
  });

  it('should degrade to cpu-roundtrip precision when timestamp-query is unavailable', async () => {
    const mockPage = {
      url: () => 'https://example.com/',
      evaluate: vi.fn().mockResolvedValue({
        frameTimesMs: [16, 17, 16, 16],
        gpuTimesMs: [],
        timestampSupported: false,
        timestampPeriod: 0,
      }),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ metrics: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };
    ctx.pageController = { getActivePage: async () => mockPage } as any;
    handlers = new WebGPUHandlers(ctx);

    const response = await handlers.webgpu_frame_timing({ frameCount: 4 });
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.precision).toBe('cpu-roundtrip');
    expect(result.cpuOrGpuBound).toBe('unknown');
    expect(result.avgGpuMs).toBeNull();
    expect(result.avgFrameMs).toBeGreaterThan(0);
  });

  it('should include per-frame timestamps when includeTimestamps is true', async () => {
    const mockPage = {
      url: () => 'https://example.com/',
      evaluate: vi.fn().mockResolvedValue({
        frameTimesMs: [16, 17, 16, 16],
        gpuTimesMs: [8, 9, 8, 8],
        timestampSupported: true,
        timestampPeriod: 1,
      }),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ metrics: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };
    ctx.pageController = { getActivePage: async () => mockPage } as any;
    handlers = new WebGPUHandlers(ctx);

    const response = await handlers.webgpu_frame_timing({
      frameCount: 4,
      includeTimestamps: true,
    });
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.frames)).toBe(true);
    expect(result.frames.length).toBe(4);
    expect(result.frames[0]).toMatchObject({ frameIndex: 0, frameMs: 16, gpuMs: 8 });
  });
});
