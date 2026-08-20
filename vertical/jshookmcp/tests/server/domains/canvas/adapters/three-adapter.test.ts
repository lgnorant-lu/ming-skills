/**
 * Tests for ThreeJsCanvasAdapter.
 *
 * Covers:
 *  - CanvasEngineAdapter interface conformance
 *  - detect() success / failure paths
 *  - dumpScene() runs the payload script against a fake window.THREE + mock scene
 *    and returns a properly-shaped scene tree
 *  - pickAt() delegates to the payload and returns the mock result
 *  - payload builders produce non-empty self-contained JS strings
 */
import { describe, expect, it, vi } from 'vitest';
import type { PageController } from '@server/domains/canvas/dependencies';
import type { CanvasProbeEnv } from '@server/domains/canvas/types';
import {
  ThreeJsCanvasAdapter,
  buildThreeSceneTreeDumpPayload,
  buildThreeHitTestPayload,
} from '@server/domains/canvas/adapters/three-adapter';

// ── Mock THREE namespace ──────────────────────────────────────────────────────

/**
 * Minimal-but-functional mock of THREE math classes used by the adapter script.
 * Matrix4.decompose reads translation from elements[12..14] (column-major).
 */
function createMockTHREE(): Record<string, unknown> {
  class Vector3 {
    x = 0;
    y = 0;
    z = 0;
    constructor(x?: number, y?: number, z?: number) {
      if (x !== undefined) this.x = x;
      if (y !== undefined) this.y = y;
      if (z !== undefined) this.z = z;
    }
  }
  class Quaternion {
    x = 0;
    y = 0;
    z = 0;
    w = 1;
  }
  class Euler {
    x = 0;
    y = 0;
    z = 0;
    setFromQuaternion(): this {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      return this;
    }
  }
  class Matrix4 {
    elements: number[] = Array.from({ length: 16 }).fill(0) as number[];
    decompose(pos: Vector3, quat: Quaternion, scale: Vector3): void {
      pos.x = this.elements[12] ?? 0;
      pos.y = this.elements[13] ?? 0;
      pos.z = this.elements[14] ?? 0;
      scale.x = 1;
      scale.y = 1;
      scale.z = 1;
      quat.x = 0;
      quat.y = 0;
      quat.z = 0;
      quat.w = 1;
    }
  }
  return {
    Vector3,
    Quaternion,
    Euler,
    Matrix4,
    REVISION: '160',
    Raycaster: class {
      setFromCamera(): void {}
      intersectObjects(): [] {
        return [];
      }
    },
  };
}

/** Build a mock THREE.Scene with one nested mesh for tree extraction. */
function createMockScene(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const THREE = createMockTHREE() as any;

  // Child mesh at position (5, 6, 0)
  const childMw = new THREE.Matrix4();
  childMw.elements[12] = 5;
  childMw.elements[13] = 6;
  const childMesh = {
    type: 'Mesh',
    uuid: 'child-uuid-1',
    name: 'ChildCube',
    visible: true,
    matrixWorld: childMw,
    children: [],
    geometry: null,
    material: { type: 'MeshBasicMaterial' },
    userData: {},
    position: { x: 5, y: 6, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };

  // Parent mesh at position (10, 20, 0) with a vertex-bearing geometry
  const parentMw = new THREE.Matrix4();
  parentMw.elements[12] = 10;
  parentMw.elements[13] = 20;
  const parentMesh = {
    type: 'Mesh',
    uuid: 'parent-uuid-1',
    name: 'ParentCube',
    visible: true,
    matrixWorld: parentMw,
    children: [childMesh],
    geometry: {
      attributes: { position: { count: 24 } },
      computeBoundingBox(): void {
        (parentMesh as { geometry: { boundingBox: unknown } }).geometry.boundingBox = {
          min: { x: -1, y: -1, z: -1 },
          max: { x: 1, y: 1, z: 1 },
        };
      },
      boundingBox: null,
    },
    material: { type: 'MeshStandardMaterial' },
    userData: { interactive: true },
    position: { x: 10, y: 20, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 2, y: 2, z: 2 },
  };

  // Scene root
  const sceneMw = new THREE.Matrix4();
  return {
    type: 'Scene',
    isScene: true,
    uuid: 'scene-uuid-1',
    name: 'MainScene',
    visible: true,
    matrixWorld: sceneMw,
    children: [parentMesh],
    userData: {},
  };
}

/** Build a fake window with THREE + __threeScene, suitable for executing the payload. */
function createMockWindow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    THREE: createMockTHREE(),
    __threeScene: createMockScene(),
    devicePixelRatio: 1,
    innerWidth: 1920,
    innerHeight: 1080,
    ...overrides,
  };
}

/**
 * Execute the payload script against mocked globals.
 *
 * The payload is `(function(){ ... })()` — a self-contained IIFE that reads
 * `window`, `document`, `WebGL2RenderingContext`, and `WebGLRenderingContext`.
 * We inject fakes via Function parameters so the script runs hermetically.
 */
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

describe('ThreeJsCanvasAdapter', () => {
  describe('interface conformance', () => {
    it('has id "three" and engine "Three.js"', () => {
      const adapter = new ThreeJsCanvasAdapter();
      expect(adapter.id).toBe('three');
      expect(adapter.engine).toBe('Three.js');
    });

    it('implements detect/dumpScene/pickAt', () => {
      const adapter = new ThreeJsCanvasAdapter();
      expect(typeof adapter.detect).toBe('function');
      expect(typeof adapter.dumpScene).toBe('function');
      expect(typeof adapter.pickAt).toBe('function');
    });
  });

  describe('detect()', () => {
    it('returns null when window.THREE is undefined', async () => {
      const [pageController] = createMockPageController({
        present: false,
        hasScene: false,
      });
      const adapter = new ThreeJsCanvasAdapter();
      const result = await adapter.detect(createEnv(pageController));
      expect(result).toBeNull();
    });

    it('returns CanvasDetection when THREE present and scene reachable', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasScene: true,
        version: 'r160',
      });
      const adapter = new ThreeJsCanvasAdapter();
      const result = await adapter.detect(createEnv(pageController));
      expect(result).not.toBeNull();
      expect(result!.engine).toBe('Three.js');
      expect(result!.adapterId).toBe('three');
      expect(result!.version).toBe('r160');
      expect(result!.confidence).toBeGreaterThan(0);
      expect(result!.evidence.some((e: string) => e.includes('THREE'))).toBe(true);
    });

    it('returns detection with reduced confidence when scene is not reachable', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasScene: false,
        version: 'r160',
      });
      const adapter = new ThreeJsCanvasAdapter();
      const result = await adapter.detect(createEnv(pageController));
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeLessThan(0.95);
    });

    it('returns null when evaluate throws', async () => {
      const pageController = {
        evaluate: vi.fn().mockRejectedValue(new Error('CDP error')),
      } as unknown as PageController;
      const adapter = new ThreeJsCanvasAdapter();
      const result = await adapter.detect(createEnv(pageController));
      expect(result).toBeNull();
    });
  });

  describe('dumpScene()', () => {
    it('extracts a nested scene tree by running the payload against a mock THREE scene', async () => {
      // Mock evaluate to RUN the payload script against a fake window.THREE + scene.
      const mockWindow = createMockWindow();
      const evaluate = vi.fn(async (script: string) => executePayload(script, mockWindow));
      const pageController = { evaluate } as unknown as PageController;

      const adapter = new ThreeJsCanvasAdapter();
      const result = await adapter.dumpScene(createEnv(pageController), { maxDepth: 20 });

      expect(result.engine).toBe('Three.js');
      expect(result.completeness).toBe('full');
      expect(result.sceneTree).not.toBeNull();
      expect(result.sceneTree!.type).toBe('Scene');
      expect(result.sceneTree!.children).toBeDefined();
      expect(result.sceneTree!.children!.length).toBe(1);

      // Parent mesh
      const parent = result.sceneTree!.children![0]!;
      expect(parent.name).toBe('ParentCube');
      expect(parent.x).toBe(10);
      expect(parent.y).toBe(20);
      // customData carries material + vertex info
      expect(parent.customData).toBeDefined();
      expect(parent.customData!.materialType).toBe('MeshStandardMaterial');
      expect(parent.customData!.vertexCount).toBe(24);

      // Nested child
      expect(parent.children).toBeDefined();
      expect(parent.children!.length).toBe(1);
      expect(parent.children![0]!.name).toBe('ChildCube');
      expect(parent.children![0]!.x).toBe(5);
      expect(parent.children![0]!.y).toBe(6);

      expect(result.totalNodes).toBe(3); // scene + parent + child
    });

    it('returns partial completeness when THREE is absent', async () => {
      // Mock evaluate runs the script, but window has no THREE
      const mockWindow = createMockWindow({ THREE: undefined });
      const evaluate = vi.fn(async (script: string) => executePayload(script, mockWindow));
      const pageController = { evaluate } as unknown as PageController;

      const adapter = new ThreeJsCanvasAdapter();
      const result = await adapter.dumpScene(createEnv(pageController), {});

      expect(result.completeness).toBe('partial');
      expect(result.sceneTree).not.toBeNull(); // falls back to empty stub
      expect(result.sceneTree!.type).toBe('Scene');
    });

    it('returns partial when scene is not reachable from window', async () => {
      // THREE present but no scene-like object discoverable
      const mockWindow = createMockWindow({ __threeScene: undefined });
      // Ensure no scene-like key is found by the window scan
      (mockWindow as Record<string, unknown>).otherGlobal = { type: 'NotAScene' };
      const evaluate = vi.fn(async (script: string) => executePayload(script, mockWindow));
      const pageController = { evaluate } as unknown as PageController;

      const adapter = new ThreeJsCanvasAdapter();
      const result = await adapter.dumpScene(createEnv(pageController), {});

      expect(result.completeness).toBe('partial');
    });
  });

  describe('pickAt()', () => {
    it('returns the pick result from the payload', async () => {
      const picked = {
        id: 'three_parent-uuid-1',
        type: 'Mesh',
        name: 'ParentCube',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 10,
        y: 20,
        width: 2,
        height: 2,
        worldBounds: { x: 10, y: 20, width: 2, height: 2 },
        path: 'THREE.Scene/raycast/three_parent-uuid-1',
      };
      const [pageController] = createMockPageController({
        success: true,
        picked,
        candidates: [{ node: picked, depth: 1 }],
        coordinates: { screen: { x: 100, y: 100 }, canvas: { x: 100, y: 100 } },
        hitTestMethod: 'engine',
      });

      const adapter = new ThreeJsCanvasAdapter();
      const result = await adapter.pickAt(createEnv(pageController), { x: 100, y: 100 });

      expect(result.success).toBe(true);
      expect(result.picked).not.toBeNull();
      expect(result.picked!.name).toBe('ParentCube');
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

      const adapter = new ThreeJsCanvasAdapter();
      const result = await adapter.pickAt(createEnv(pageController), { x: 0, y: 0 });

      expect(result.success).toBe(false);
      expect(result.picked).toBeNull();
      expect(result.hitTestMethod).toBe('none');
    });
  });
});

// ── Payload builder tests ─────────────────────────────────────────────────────

describe('buildThreeSceneTreeDumpPayload', () => {
  it('returns a non-empty JavaScript string', () => {
    const payload = buildThreeSceneTreeDumpPayload({});
    expect(typeof payload).toBe('string');
    expect(payload.length).toBeGreaterThan(0);
  });

  it('embeds maxDepth option in the script', () => {
    const payload = buildThreeSceneTreeDumpPayload({ maxDepth: 7 });
    expect(payload).toContain('7');
  });

  it('embeds onlyInteractive flag', () => {
    const payload = buildThreeSceneTreeDumpPayload({ onlyInteractive: true });
    expect(payload).toContain('true');
  });

  it('references window.THREE and Scene discovery', () => {
    const payload = buildThreeSceneTreeDumpPayload({});
    expect(payload).toContain('window.THREE');
    expect(payload).toContain('isScene');
  });
});

describe('buildThreeHitTestPayload', () => {
  it('returns a non-empty JavaScript string', () => {
    const payload = buildThreeHitTestPayload({ x: 10, y: 20 });
    expect(typeof payload).toBe('string');
    expect(payload.length).toBeGreaterThan(0);
  });

  it('embeds x and y coordinates', () => {
    const payload = buildThreeHitTestPayload({ x: 123, y: 456 });
    expect(payload).toContain('123');
    expect(payload).toContain('456');
  });

  it('embeds canvasId when provided', () => {
    const payload = buildThreeHitTestPayload({ x: 0, y: 0, canvasId: 'my-canvas' });
    expect(payload).toContain('my-canvas');
  });
});
