import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildLayaHitTestPayload,
  buildLayaSceneTreeDumpPayload,
} from '@server/domains/canvas/adapters/laya-adapter';

// ── Faithful Laya mock (JSDOM) ────────────────────────────────────────────────
//
// localToGlobal / globalToLocal are exact inverses of the standard Laya affine
// transform: pivot is the rotate/scale center (maps to the node's x/y position),
// and the node's own local frame is top-left origin (0,0 .. width,height).

/* eslint-disable @typescript-eslint/no-explicit-any */

function cosd(deg: number): number {
  return Math.cos((deg * Math.PI) / 180);
}
function sind(deg: number): number {
  return Math.sin((deg * Math.PI) / 180);
}

// Faithful Laya.Point: localToGlobal/globalToLocal write their result back via
// point.setTo(x, y). LayaAir 2.8's minified build calls t.setTo() on the passed
// point, so a plain {x,y} literal throws "t.setTo is not a function" — matching
// the real engine on http://aola.100bt.com/h5. The adapter must wrap its point
// literals in a real Laya.Point (see toPt in laya-adapter.ts).
class LayaPoint {
  x: number;
  y: number;
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  setTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }
}

function makeLayaNode(props: Record<string, any> = {}): any {
  const node: any = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    pivotX: 0,
    pivotY: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    visible: true,
    mouseEnabled: true,
    alpha: 1,
    parent: null,
    children: [],
    numChildren: 0,
    name: undefined,
    id: undefined,
    ...props,
  };
  node.constructor = { name: props.typeName ?? 'Node' };

  node.addChild = function (child: any): any {
    child.parent = node;
    node.children.push(child);
    node.numChildren = node.children.length;
    return child;
  };

  node.localToGlobal = function (point: any): any {
    let x = point.x;
    let y = point.y;
    let cur: any = node;
    while (cur) {
      const px = x - cur.pivotX;
      const py = y - cur.pivotY;
      const sx = px * cur.scaleX;
      const sy = py * cur.scaleY;
      const c = cosd(cur.rotation);
      const s = sind(cur.rotation);
      const rx = sx * c - sy * s;
      const ry = sx * s + sy * c;
      x = rx + cur.x;
      y = ry + cur.y;
      cur = cur.parent;
    }
    // Faithful to Laya 2.8: the result is written back through point.setTo(),
    // so a plain {x,y} literal (no setTo) throws exactly like the real engine.
    point.setTo(x, y);
    return point;
  };

  node.globalToLocal = function (point: any): any {
    let x = point.x;
    let y = point.y;
    const chain: any[] = [];
    let cur: any = node;
    while (cur) {
      chain.push(cur);
      cur = cur.parent;
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const n = chain[i]!;
      const dx = x - n.x;
      const dy = y - n.y;
      const c = cosd(n.rotation);
      const s = sind(n.rotation);
      const ux = dx * c + dy * s;
      const uy = -dx * s + dy * c;
      x = ux / n.scaleX + n.pivotX;
      y = uy / n.scaleY + n.pivotY;
    }
    point.setTo(x, y);
    return point;
  };

  return node;
}

interface SetupOpts {
  clientScaleX?: number;
  isLaya3?: boolean;
}

function setupLayaPage(opts: SetupOpts = {}) {
  const clientScale = opts.clientScaleX ?? 1;
  const designWidth = 400 / clientScale;
  const designHeight = 300 / clientScale;

  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><canvas id="game" width="400" height="300"></canvas></body></html>',
    { url: 'https://example.com/', runScripts: 'outside-only', pretendToBeVisual: true },
  );
  const { window } = dom;
  const canvas = window.document.getElementById('game') as unknown as HTMLCanvasElement;
  canvas.getBoundingClientRect = (() => ({
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    x: 0,
    y: 0,
  })) as unknown as HTMLCanvasElement['getBoundingClientRect'];
  canvas.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

  const stage = makeLayaNode({
    x: 0,
    y: 0,
    width: designWidth,
    height: designHeight,
    typeName: 'Stage',
    clientScaleX: clientScale,
    clientScaleY: clientScale,
  });

  window.Laya = {
    version: opts.isLaya3 ? '3.0.0' : '2.12.0',
    stage,
    Point: LayaPoint,
  } as any;
  if (opts.isLaya3) {
    (window.Laya as any).InputManager = {};
  } else {
    (window.Laya as any).MouseManager = {};
  }

  return { window, stage, canvas, dom };
}

function runPick(window: any, x: number, y: number, canvasId = 'game'): any {
  const payload = buildLayaHitTestPayload({ x, y, canvasId });
  return window.eval(payload);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildLayaHitTestPayload (executed on a faithful Laya mock)', () => {
  it('picks the sprite, not the Stage, when clicking inside it (2.x DFS)', () => {
    const { window, stage } = setupLayaPage();
    const sprite = makeLayaNode({
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      typeName: 'Sprite',
      id: 'player',
      mouseEnabled: true,
    });
    stage.addChild(sprite);

    const result = runPick(window, 125, 125);

    expect(result.success).toBe(true);
    expect(result.picked).not.toBeNull();
    expect(result.picked.id).toBe('player');
    expect(result.picked.type).toBe('Sprite');
    expect(result.hitTestMethod).toBe('manual');
  });

  it('picks the sprite correctly under clientScaleX=2 scaling', () => {
    const { window, stage } = setupLayaPage({ clientScaleX: 2 });
    // Design: sprite at (100,100) size 50 → screen [200,300]×[200,300].
    // Screen (275,275) → design (137.5,137.5), inside the sprite. The raw
    // screen coordinate 275 is NOT inside the unscaled sprite bounds, so a
    // DFS that forgets the clientScale compensation would miss the sprite.
    const sprite = makeLayaNode({
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      typeName: 'Sprite',
      id: 'player',
    });
    stage.addChild(sprite);

    const result = runPick(window, 275, 275);

    expect(result.picked).not.toBeNull();
    expect(result.picked.id).toBe('player');
  });

  it('picks the deepest node in a two-level parent/child hierarchy', () => {
    const { window, stage } = setupLayaPage();
    const parent = makeLayaNode({
      x: 50,
      y: 50,
      width: 200,
      height: 200,
      typeName: 'Container',
      id: 'parent',
    });
    const child = makeLayaNode({
      x: 25,
      y: 25,
      width: 50,
      height: 50,
      typeName: 'Sprite',
      id: 'child',
    });
    parent.addChild(child);
    stage.addChild(parent);

    // child world bounds = [75,125]×[75,125].
    const result = runPick(window, 100, 100);

    expect(result.picked).not.toBeNull();
    expect(result.picked.id).toBe('child');
  });

  it('ignores the stale stage.mouseX/mouseY (always 0 under CDP) and computes stage coords directly', () => {
    const { window, stage } = setupLayaPage();
    const sprite = makeLayaNode({
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      typeName: 'Sprite',
      id: 'player',
    });
    stage.addChild(sprite);
    // Real Laya 2.8 on the target page keeps stage.mouseX/mouseY at 0 because
    // the engine's own event system never receives a real mouse event under CDP.
    // Reading them as "valid" would make the stage coordinate a constant (0,0)
    // and miss the sprite entirely.
    stage.mouseX = 0;
    stage.mouseY = 0;

    const result = runPick(window, 125, 125);

    expect(result.picked).not.toBeNull();
    expect(result.picked.id).toBe('player');
    expect(result.coordinates.stage.x).toBe(125);
    expect(result.coordinates.stage.y).toBe(125);
  });

  it('returns a full CanvasSceneNode from the 3.x engine path', () => {
    const { window, stage } = setupLayaPage({ isLaya3: true });
    const sprite = makeLayaNode({
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      typeName: 'Sprite',
      id: 'player',
    });
    stage.addChild(sprite);
    (stage as any).hitTest = function (): any {
      return sprite;
    };

    const result = runPick(window, 125, 125);

    expect(result.hitTestMethod).toBe('engine');
    expect(result.picked).not.toBeNull();
    expect(result.picked.type).toBe('Sprite');
    expect(result.picked.worldBounds).toBeDefined();
    expect(result.picked.worldBounds.x).toBeTypeOf('number');
    expect(result.picked.worldBounds.width).toBe(50);
    expect(result.picked.path).toBeTypeOf('string');
  });
});

describe('buildLayaSceneTreeDumpPayload (executed on a faithful Laya mock)', () => {
  it('computes a ~141×141 worldBounds for a 45° rotated 100×100 sprite', () => {
    const { window, stage } = setupLayaPage();
    const sprite = makeLayaNode({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      pivotX: 50,
      pivotY: 50,
      rotation: 45,
      typeName: 'Sprite',
      id: 'rot',
    });
    stage.addChild(sprite);

    const payload = buildLayaSceneTreeDumpPayload({});
    const result = window.eval(payload) as any;

    const child = result.sceneTree?.children?.[0];
    expect(child).toBeDefined();
    expect(child.worldBounds.width).toBeGreaterThan(140);
    expect(child.worldBounds.width).toBeLessThan(143);
    expect(child.worldBounds.height).toBeGreaterThan(140);
    expect(child.worldBounds.height).toBeLessThan(143);
  });
});
