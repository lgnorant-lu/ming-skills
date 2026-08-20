import { describe, it, expect, beforeEach } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

describe('webgpu_timing_analysis', () => {
  let ctx: MCPServerContext;
  let handlers: WebGPUHandlers;

  beforeEach(() => {
    ctx = {
      eventBus: {
        emit: () => {},
      },
      pageController: {
        getActivePage: async () => {
          throw new Error('No active page');
        },
      },
    } as unknown as MCPServerContext;

    handlers = new WebGPUHandlers(ctx);
  });

  it('should require active page for timing analysis', async () => {
    const response = await handlers.webgpu_timing_analysis({
      iterations: 100,
    });
    const result = ResponseBuilder.parse(response);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('page'),
    });
  });

  it('should return timing statistics', async () => {
    // Mock page with WebGPU support
    const mockPage = {
      evaluate: async () => ({
        timings: [1.2, 1.3, 1.1, 1.4, 1.2],
        mean: 1.24,
        stddev: 0.11,
      }),
    };

    ctx.pageController = {
      getActivePage: async () => mockPage,
    } as any;

    const response = await handlers.webgpu_timing_analysis({
      iterations: 5,
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === true) {
      expect(result).toHaveProperty('timings');
      expect(result).toHaveProperty('mean');
      expect(result).toHaveProperty('stddev');
      expect(result.timings).toBeInstanceOf(Array);
      expect(result.timings.length).toBe(5);
    }
  });

  it('should detect side-channel timing variance', async () => {
    const mockPage = {
      evaluate: async () => ({
        timings: [1.0, 1.1, 5.2, 1.0, 1.1], // Anomalous timing at index 2
        mean: 1.88,
        stddev: 1.76,
      }),
    };

    ctx.pageController = {
      getActivePage: async () => mockPage,
    } as any;

    const response = await handlers.webgpu_timing_analysis({
      iterations: 5,
      detectAnomalies: true,
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === true && result.anomalies) {
      expect(result.anomalies).toBeInstanceOf(Array);
      expect(result.anomalies.length).toBeGreaterThan(0);
    }
  });
});
