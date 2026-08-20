import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PageController } from '@server/domains/shared/modules/collector';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

vi.mock('@modules/skia-capture/SkiaSceneExtractor', () => {
  const detectSkiaRenderer = vi.fn().mockResolvedValue({
    isSkiaBacked: true,
    version: '1.0',
    gpuBackend: 'gl',
    shaderPipeline: 'OpenGL',
    rendererStrings: ['ANGLE'],
    features: [],
    confidence: 0.9,
    evidence: ['test'],
  });
  const extractSceneTree = vi.fn().mockResolvedValue({
    rootLayer: {
      id: 'root',
      name: 'root',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      transform: [],
      opacity: 1,
      visible: true,
      children: [],
    },
    layers: [
      {
        id: 'root',
        name: 'root',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        transform: [],
        opacity: 1,
        visible: true,
        children: [],
      },
    ],
    drawCommands: [
      { type: 'drawRect', bounds: { x: 0, y: 0, width: 800, height: 600 }, paintInfo: {} },
    ],
    totalLayers: 1,
    totalDrawCommands: 1,
    canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
  });
  return {
    detectSkiaRenderer,
    extractSceneTree,
  };
});

let SkiaCaptureHandlers: typeof import('@server/domains/canvas/skia').SkiaCaptureHandlers;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('@server/domains/canvas/skia');
  SkiaCaptureHandlers = mod.SkiaCaptureHandlers;
});

function makeMockPC(): PageController {
  return { evaluate: vi.fn() } as unknown as PageController;
}

describe('SkiaCaptureHandlers', () => {
  describe('handleSkiaDetectRenderer', () => {
    it('should throw when pageController is missing', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: null });
      await expect(handlers.handleSkiaDetectRenderer({})).rejects.toThrow(
        'PageController not available',
      );
    });

    it('turns wrapper prerequisite failures into structured responses', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: null });
      const result = await handlers.handleSkiaDetectRendererTool({});
      const body = ResponseBuilder.parse<Record<string, unknown>>(result);
      expect(body).toMatchObject({
        success: false,
        error: 'PageController not available — ensure browser is connected',
        message: 'PageController not available — ensure browser is connected',
      });
    });

    it('should call detectRenderer successfully', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: makeMockPC() });
      const result = await handlers.handleSkiaDetectRenderer({});
      expect(result).toHaveProperty('rendererInfo');
      expect(result).toHaveProperty('detectionComplete', true);
    });

    it('wraps successful renderer detection output', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: makeMockPC() });
      const result = await handlers.handleSkiaDetectRendererTool({});
      const body = ResponseBuilder.parse<Record<string, unknown>>(result);
      expect(body).toMatchObject({
        success: true,
        detectionComplete: true,
      });
      expect(body.content).toBeUndefined();
    });
  });

  describe('handleSkiaExtractScene', () => {
    it('should throw when pageController is missing', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: null });
      await expect(handlers.handleSkiaExtractScene({})).rejects.toThrow(
        'PageController not available',
      );
    });

    it('should call dumpScene successfully', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: makeMockPC() });
      const result = await handlers.handleSkiaExtractScene({});
      expect(result).toHaveProperty('sceneTree');
      expect(result).toHaveProperty('extractionComplete', true);
    });
  });

  describe('handleSkiaCorrelateObjects', () => {
    it('should throw when pageController is missing', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: null });
      await expect(handlers.handleSkiaCorrelateObjects({})).rejects.toThrow(
        'PageController not available',
      );
    });
  });
});
