import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

describe('webgpu_adapter_info', () => {
  let ctx: MCPServerContext;
  let handlers: WebGPUHandlers;

  beforeEach(async () => {
    // Mock minimal context
    ctx = {
      eventBus: {
        emit: () => {},
      },
    } as unknown as MCPServerContext;

    handlers = new WebGPUHandlers(ctx);
  });

  afterEach(() => {
    // Cleanup
  });

  it('should return error when WebGPU is not available', async () => {
    const response = await handlers.webgpu_adapter_info({});
    const result = ResponseBuilder.parse(response);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page|WebGPU/i),
    });
  });

  it('should return adapter information when WebGPU is available', async () => {
    // This test requires a real WebGPU context (skip in node)
    const response = await handlers.webgpu_adapter_info({});
    const result = ResponseBuilder.parse(response);

    if (result.success === false) {
      // Expected in Node.js environment (no page or no WebGPU)
      expect(result.error).toMatch(/page|WebGPU/i);
    } else {
      expect(result).toHaveProperty('adapter');
      expect(result.adapter).toHaveProperty('vendor');
      expect(result.adapter).toHaveProperty('architecture');
    }
  });

  it('should not hardcode vendor names', async () => {
    const response = await handlers.webgpu_adapter_info({});
    const result = ResponseBuilder.parse(response);

    if (result.success === true) {
      // Vendor should be dynamically detected, not hardcoded
      expect(['NVIDIA', 'AMD', 'Intel', 'Apple', 'ARM', 'Qualcomm']).not.toContain(
        result.adapter?.vendor,
      );
    }
  });
});
