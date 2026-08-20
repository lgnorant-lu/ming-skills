/**
 * Tests for BabylonCanvasAdapter.
 *
 * Covers:
 *  - CanvasEngineAdapter interface conformance
 *  - detect() success / failure paths
 *  - dumpScene() runs the payload script against a fake window.BABYLON + mock scene
 *    and returns a properly-shaped scene tree (meshes / cameras / lights)
 *  - pickAt() delegates to the payload and returns the mock result
 *  - payload builders produce non-empty self-contained JS strings
 */
import { describe, expect, it, vi } from 'vitest';
import type { PageController } from '@server/domains/canvas/dependencies';
import type { CanvasProbeEnv } from '@server/domains/canvas/types';
import {
  BabylonCanvasAdapter,
  buildBabylonSceneTreeDumpPayload,
  buildBabylonHitTestPayload,
} from '@server/domains/canvas/adapters/babylon-adapter';

// ── Mock BABYLON namespace ────────────────────────────────────────────────────

/** Build a mock Babylon scene with one mesh, camera, and light. */
function createMockScene(): Record<string, unknown> {
  const mesh = {
    name: 'GroundMesh',
    uniqueId: 1,
    id: 'mesh-1',
    isVisible: true,
    isEnabled: true,
    isPickable: true,
    alpha: 1,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scaling: { x: 10, y: 1, z: 10 },
    material: { name: 'groundMat' },
    geometry: {
      getVerticesData: (kind: string) =>
        kind === 'position' ? (Array.from({ length: 12 * 3 }).fill(0) as number[]) : null,
    },
    getClassName: () => 'Mesh',
    getBoundingInfo: () => ({
      boundingBox: {
        minimumWorld: { x: -5, y: 0, z: -5 },
        maximumWorld: { x: 5, y: 1, z: 5 },
      },
    }),
    getChildTransformNodes: () => [],
  };

  const camera = {
    name: 'ArcRotateCamera',
    uniqueId: 2,
    id: 'cam-1',
    isVisible: true,
    isEnabled: true,
    isPickable: false,
    position: { x: 0, y: 10, z: -20 },
    rotation: { x: 0, y: 0, z: 0 },
    scaling: { x: 1, y: 1, z: 1 },
    getClassName: () => 'ArcRotateCamera',
  };

  const light = {
    name: 'HemisphericLight',
    uniqueId: 3,
    id: 'light-1',
    isVisible: true,
    isEnabled: true,
    isPickable: false,
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scaling: { x: 1, y: 1, z: 1 },
    getClassName: () => 'HemisphericLight',
  };

  return {
    name: 'main-scene',
    uniqueId: 0,
    id: 'scene-root',
    isVisible: true,
    isEnabled: true,
    meshes: [mesh],
    transformNodes: [],
    cameras: [camera],
    lights: [light],
    pick: () => ({ hit: false, pickedMesh: null }),
  };
}

function createMockBABYLON(): Record<string, unknown> {
  const scene = createMockScene();
  const engine = {
    scenes: [scene],
  };
  return {
    Engine: Object.assign(function MockEngine() {}, {
      Instances: [engine],
      LastCreatedScene: scene,
      Version: '6.0.0',
    }),
  };
}

function createMockWindow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    BABYLON: createMockBABYLON(),
    devicePixelRatio: 1,
    ...overrides,
  };
}

/** Execute the payload script against mocked globals (see three-adapter.test.ts). */
function executePayload(script: string, mockWindow: Record<string, unknown>): unknown {
  const mockDocument = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function(
    'window',
    'document',
    'WebGL2RenderingContext',
    'WebGLRenderingContext',
    `return (${script});`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fn(
    mockWindow as any,
    mockDocument as any,
    function MockWebGL2RenderingContext() {},
    function MockWebGLRenderingContext() {},
  );
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function createMockPageController<T = unknown>(
  result: T,
): [PageController, ReturnType<typeof vi.fn>] {
  const evaluate = vi.fn().mockResolvedValue(result);
  const pageController = { evaluate } as unknown as PageController;
  return [pageController, evaluate];
}

function createEnv(pageController: PageController): CanvasProbeEnv {
  return {
    pageController,
    cdpSession: null as never,
    tabId: 'tab-1',
    frameId: 'frame-0',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BabylonCanvasAdapter', () => {
  describe('interface conformance', () => {
    it('has id "babylon" and engine "Babylon.js"', () => {
      const adapter = new BabylonCanvasAdapter();
      expect(adapter.id).toBe('babylon');
      expect(adapter.engine).toBe('Babylon.js');
    });

    it('implements detect/dumpScene/pickAt', () => {
      const adapter = new BabylonCanvasAdapter();
      expect(typeof adapter.detect).toBe('function');
      expect(typeof adapter.dumpScene).toBe('function');
      expect(typeof adapter.pickAt).toBe('function');
    });
  });

  describe('detect()', () => {
    it('returns null when window.BABYLON is undefined', async () => {
      const [pageController] = createMockPageController({
        present: false,
        hasScene: false,
      });
      const adapter = new BabylonCanvasAdapter();
      const result = await adapter.detect(createEnv(pageController));
      expect(result).toBeNull();
    });

    it('returns CanvasDetection when BABYLON present and scene reachable', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasScene: true,
        version: '6.0.0',
      });
      const adapter = new BabylonCanvasAdapter();
      const result = await adapter.detect(createEnv(pageController));
      expect(result).not.toBeNull();
      expect(result!.engine).toBe('Babylon.js');
      expect(result!.adapterId).toBe('babylon');
      expect(result!.version).toBe('6.0.0');
      expect(result!.confidence).toBeGreaterThan(0);
      expect(result!.evidence.some((e: string) => e.includes('BABYLON'))).toBe(true);
    });

    it('returns reduced confidence when no scene found', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasScene: false,
        version: '5.0.0',
      });
      const adapter = new BabylonCanvasAdapter();
      const result = await adapter.detect(createEnv(pageController));
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeLessThan(0.95);
    });

    it('returns null when evaluate throws', async () => {
      const pageController = {
        evaluate: vi.fn().mockRejectedValue(new Error('CDP error')),
      } as unknown as PageController;
      const adapter = new BabylonCanvasAdapter();
      const result = await adapter.detect(createEnv(pageController));
      expect(result).toBeNull();
    });
  });

  describe('dumpScene()', () => {
    it('extracts meshes / cameras / lights by running the payload against a mock BABYLON scene', async () => {
      const mockWindow = createMockWindow();
      const evaluate = vi.fn(async (script: string) => executePayload(script, mockWindow));
      const pageController = { evaluate } as unknown as PageController;

      const adapter = new BabylonCanvasAdapter();
      const result = await adapter.dumpScene(createEnv(pageController), { maxDepth: 20 });

      expect(result.engine).toBe('Babylon.js');
      expect(result.completeness).toBe('full');
      expect(result.sceneTree).not.toBeNull();
      expect(result.sceneTree!.type).toBe('Scene');
      expect(result.sceneTree!.children).toBeDefined();

      // Should contain mesh + camera + light (3 children)
      const childTypes = result.sceneTree!.children!.map((c) => c.type);
      expect(childTypes).toContain('Mesh');
      expect(childTypes).toContain('ArcRotateCamera');
      expect(childTypes).toContain('HemisphericLight');

      // Mesh details
      const mesh = result.sceneTree!.children!.find((c) => c.type === 'Mesh')!;
      expect(mesh.name).toBe('GroundMesh');
      expect(mesh.customData).toBeDefined();
      expect(mesh.customData!.materialName).toBe('groundMat');
      expect(mesh.customData!.vertexCount).toBe(12);
      expect(mesh.customData!.uniqueId).toBe(1);

      expect(result.totalNodes).toBe(4); // scene + mesh + camera + light
    });

    it('returns partial when BABYLON is absent', async () => {
      const mockWindow = createMockWindow({ BABYLON: undefined });
      const evaluate = vi.fn(async (script: string) => executePayload(script, mockWindow));
      const pageController = { evaluate } as unknown as PageController;

      const adapter = new BabylonCanvasAdapter();
      const result = await adapter.dumpScene(createEnv(pageController), {});

      expect(result.completeness).toBe('partial');
      expect(result.sceneTree).not.toBeNull();
      expect(result.sceneTree!.type).toBe('Scene');
    });

    it('returns partial when Engine.Instances is empty', async () => {
      // BABYLON present but no engine instances
      const mockWindow: Record<string, unknown> = {
        BABYLON: {
          Engine: Object.assign(function () {}, {
            Instances: [],
            Version: '6.0.0',
          }),
        },
        devicePixelRatio: 1,
      };
      const evaluate = vi.fn(async (script: string) => executePayload(script, mockWindow));
      const pageController = { evaluate } as unknown as PageController;

      const adapter = new BabylonCanvasAdapter();
      const result = await adapter.dumpScene(createEnv(pageController), {});

      expect(result.completeness).toBe('partial');
    });
  });

  describe('pickAt()', () => {
    it('returns the pick result from the payload', async () => {
      const picked = {
        id: 'babylon_1',
        type: 'Mesh',
        name: 'GroundMesh',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 0,
        y: 0,
        width: 10,
        height: 1,
        worldBounds: { x: 0, y: 0, width: 10, height: 1 },
        path: 'Babylon.Scene/pick/babylon_1',
      };
      const [pageController] = createMockPageController({
        success: true,
        picked,
        candidates: [{ node: picked, depth: 1 }],
        coordinates: { screen: { x: 50, y: 50 }, canvas: { x: 50, y: 50 } },
        hitTestMethod: 'engine',
      });

      const adapter = new BabylonCanvasAdapter();
      const result = await adapter.pickAt(createEnv(pageController), { x: 50, y: 50 });

      expect(result.success).toBe(true);
      expect(result.picked).not.toBeNull();
      expect(result.picked!.name).toBe('GroundMesh');
      expect(result.hitTestMethod).toBe('engine');
    });

    it('returns failed pick when no hit', async () => {
      const [pageController] = createMockPageController({
        success: false,
        picked: null,
        candidates: [],
        coordinates: { screen: { x: 0, y: 0 }, canvas: { x: 0, y: 0 } },
        hitTestMethod: 'none',
      });

      const adapter = new BabylonCanvasAdapter();
      const result = await adapter.pickAt(createEnv(pageController), { x: 0, y: 0 });

      expect(result.success).toBe(false);
      expect(result.picked).toBeNull();
      expect(result.hitTestMethod).toBe('none');
    });
  });
});

// ── Payload builder tests ─────────────────────────────────────────────────────

describe('buildBabylonSceneTreeDumpPayload', () => {
  it('returns a non-empty JavaScript string', () => {
    const payload = buildBabylonSceneTreeDumpPayload({});
    expect(typeof payload).toBe('string');
    expect(payload.length).toBeGreaterThan(0);
  });

  it('embeds maxDepth option in the script', () => {
    const payload = buildBabylonSceneTreeDumpPayload({ maxDepth: 11 });
    expect(payload).toContain('11');
  });

  it('references BABYLON.Engine.Instances', () => {
    const payload = buildBabylonSceneTreeDumpPayload({});
    expect(payload).toContain('window.BABYLON');
    expect(payload).toContain('Instances');
    expect(payload).toContain('meshes');
    expect(payload).toContain('cameras');
    expect(payload).toContain('lights');
  });
});

describe('buildBabylonHitTestPayload', () => {
  it('returns a non-empty JavaScript string', () => {
    const payload = buildBabylonHitTestPayload({ x: 100, y: 200 });
    expect(typeof payload).toBe('string');
    expect(payload.length).toBeGreaterThan(0);
  });

  it('embeds x and y coordinates', () => {
    const payload = buildBabylonHitTestPayload({ x: 111, y: 222 });
    expect(payload).toContain('111');
    expect(payload).toContain('222');
  });

  it('uses scene.pick() native hit test', () => {
    const payload = buildBabylonHitTestPayload({ x: 0, y: 0 });
    expect(payload).toContain('scene.pick');
  });
});
