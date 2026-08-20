/**
 * Babylon.js canvas engine adapter for JSHookMCP's canvas domain.
 *
 * Supports Babylon.js 4.x / 5.x / 6.x. Detection checks window.BABYLON and the
 * Engine.Instances registry. The dump and pick payloads are self-contained JavaScript
 * strings executed in the page context via pageController.evaluate().
 *
 * Scene discovery: Babylon maintains a registry — `BABYLON.Engine.Instances[]` lists
 * every Engine, and each Engine exposes its `scenes[]`. We also honor the
 * `Engine.LastCreatedScene` convenience accessor.
 */
import type {
  CanvasDetection,
  CanvasEngineAdapter,
  CanvasHitTestMethod,
  CanvasPickResult,
  CanvasProbeEnv,
  CanvasSceneDump,
  CanvasSceneNode,
  DumpOpts,
  PickOpts,
} from '../types';

// ── Payload builders ──────────────────────────────────────────────────────────

/**
 * Generates a self-contained JS string that:
 *  1. Locates window.BABYLON
 *  2. Finds the most recently created scene via Engine.Instances / LastCreatedScene
 *  3. Walks meshes / transformNodes / cameras / lights
 *  4. Returns a serialisable scene tree
 *
 * @param opts - Dump options (maxDepth, onlyInteractive, onlyVisible)
 */
export function buildBabylonSceneTreeDumpPayload(opts: DumpOpts): string {
  const maxDepth = opts.maxDepth ?? 20;
  const onlyInteractive = opts.onlyInteractive ?? false;
  const onlyVisible = opts.onlyVisible ?? false;

  return `(function() {
  function safeProp(obj, key, fallback) {
    try { var v = obj[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function nodeId(node, idx) {
    try {
      if (node.uniqueId !== undefined && node.uniqueId !== null) return 'babylon_' + node.uniqueId;
    } catch(e) {}
    try {
      if (node.id !== undefined && node.id !== null && node.id !== '') return 'babylon_id_' + node.id;
    } catch(e) {}
    var name = node.name || (node.constructor ? node.constructor.name : 'BabylonNode');
    return String(name).replace(/\\s+/g, '_') + '_' + idx;
  }

  function getType(node) {
    try {
      var t = node.getClassName ? node.getClassName() : null;
      if (t) return t;
    } catch(e) {}
    return node.constructor ? node.constructor.name : 'BabylonNode';
  }

  function getVec3(node, key) {
    try {
      var v = node[key];
      if (v && typeof v.x === 'number') return { x: v.x, y: v.y, z: v.z };
    } catch(e) {}
    return null;
  }

  function getMaterialName(node) {
    try {
      var mat = node.material;
      if (!mat) return undefined;
      return mat.name || (mat.getClassName ? mat.getClassName() : (mat.constructor ? mat.constructor.name : 'Material'));
    } catch(e) { return undefined; }
  }

  function getVertexCount(node) {
    try {
      var geom = node.geometry;
      if (geom && geom.getVerticesData) {
        var positions = geom.getVerticesData('position');
        if (positions && positions.length > 0) return positions.length / 3;
      }
      // Fallback for older API: vertexCount stored on geometry
      if (geom && typeof geom.vertexCount === 'number') return geom.vertexCount;
    } catch(e) {}
    return undefined;
  }

  function findScene() {
    var BABYLON = window.BABYLON;
    if (!BABYLON || !BABYLON.Engine) return null;

    // Engine.Instances is the canonical registry
    var instances = BABYLON.Engine.Instances;
    if (instances && instances.length > 0) {
      for (var i = instances.length - 1; i >= 0; i--) {
        var engine = instances[i];
        if (engine && engine.scenes && engine.scenes.length > 0) {
          return engine.scenes[engine.scenes.length - 1];
        }
      }
    }
    // LastCreatedScene convenience (older API)
    try {
      var last = BABYLON.Engine.LastCreatedScene;
      if (last) return last;
    } catch(e) {}
    return null;
  }

  var totalNodes = 0;

  function makeNode(node, depth, path, typeOverride) {
    if (!node || depth > ${maxDepth}) return null;
    totalNodes++;

    var visible = safeProp(node, 'isVisible', true);
    if (visible === undefined || visible === null) visible = safeProp(node, 'enabled', true);
    var enabled = safeProp(node, 'isEnabled', true);
    var interactive = !!(safeProp(node, 'isPickable', true));

    if (${onlyVisible} && (visible === false || enabled === false)) return null;
    if (${onlyInteractive} && !interactive) return null;

    var name = safeProp(node, 'name', undefined);
    var pos = getVec3(node, 'position') || { x: 0, y: 0, z: 0 };
    var rot = getVec3(node, 'rotation') || { x: 0, y: 0, z: 0 };
    var scaling = getVec3(node, 'scaling') || { x: 1, y: 1, z: 1 };

    // Bounds approximation: Babylon meshes expose boundingInfo in world space
    var wb = { x: pos.x, y: pos.y, width: Math.abs(scaling.x), height: Math.abs(scaling.y) };
    try {
      var bi = node.getBoundingInfo ? node.getBoundingInfo() : null;
      if (bi && bi.boundingBox && bi.boundingBox.minimumWorld && bi.boundingBox.maximumWorld) {
        var mn = bi.boundingBox.minimumWorld;
        var mx = bi.boundingBox.maximumWorld;
        wb.x = mn.x; wb.y = mn.y;
        wb.width = Math.abs(mx.x - mn.x);
        wb.height = Math.abs(mx.y - mn.y);
      }
    } catch(e) {}

    var result = {
      id: nodeId(node, 0),
      type: typeOverride || getType(node),
      name: name || undefined,
      visible: !!(visible !== false && enabled !== false),
      interactive: interactive,
      alpha: safeProp(node, 'alpha', 1),
      x: pos.x,
      y: pos.y,
      width: wb.width,
      height: wb.height,
      worldBounds: wb,
      path: path || nodeId(node, 0),
      customData: {
        uniqueId: safeProp(node, 'uniqueId', undefined) || undefined,
        posX: pos.x, posY: pos.y, posZ: pos.z,
        rotX: rot.x, rotY: rot.y, rotZ: rot.z,
        scaleX: scaling.x, scaleY: scaling.y, scaleZ: scaling.z,
        materialName: getMaterialName(node),
        vertexCount: getVertexCount(node),
        isEnabled: enabled,
      }
    };

    if (result.name === undefined) delete result.name;
    if (result.customData.uniqueId === undefined) delete result.customData.uniqueId;
    return result;
  }

  function traverseTransform(parent, parentPath, depthAcc) {
    // Walk child transform nodes (Babylon's TransformNode hierarchy)
    var children = null;
    try {
      var childTransforms = parent.getChildTransformNodes ? parent.getChildTransformNodes() : null;
      if (childTransforms && childTransforms.length > 0) {
        children = [];
        for (var i = 0; i < childTransforms.length; i++) {
          var ct = childTransforms[i];
          if (!ct) continue;
          var childPath = parentPath + '/' + nodeId(ct, i);
          var node = makeNode(ct, depthAcc + 1, childPath, 'TransformNode');
          if (node) {
            var sub = traverseTransform(ct, childPath, depthAcc + 1);
            if (sub && sub.length > 0) node.children = sub;
            children.push(node);
          }
        }
      }
    } catch(e) {}
    return children;
  }

  var BABYLON = window.BABYLON;
  if (!BABYLON || !BABYLON.Engine) {
    return {
      engine: 'Babylon.js',
      version: undefined,
      canvas: { width: 0, height: 0, dpr: 1, contextType: 'unknown' },
      sceneTree: null,
      totalNodes: 0,
      completeness: 'partial',
      error: 'window.BABYLON or BABYLON.Engine is undefined'
    };
  }

  var version = BABYLON.Engine.Version || BABYLON.Engine.EngineVersion || undefined;
  var scene = findScene();

  var canvasEl = document.querySelector('canvas');
  var canvasInfo = {
    width: canvasEl ? canvasEl.width : 0,
    height: canvasEl ? canvasEl.height : 0,
    dpr: window.devicePixelRatio || 1,
    contextType: 'unknown'
  };
  if (canvasEl) {
    var gl = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl');
    canvasInfo.contextType = gl ? (gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl') : '2d';
  }

  if (!scene) {
    return {
      engine: 'Babylon.js',
      version: version,
      canvas: canvasInfo,
      sceneTree: null,
      totalNodes: 0,
      completeness: 'partial',
      error: 'No Babylon scene found in Engine.Instances or LastCreatedScene'
    };
  }

  var sceneNode = makeNode(scene, 0, 'Babylon.Scene', 'Scene');
  var sceneChildren = [];

  // Meshes
  var meshes = safeProp(scene, 'meshes', []);
  if (Array.isArray(meshes)) {
    for (var mi = 0; mi < meshes.length; mi++) {
      var mesh = meshes[mi];
      if (!mesh) continue;
      var meshPath = 'Babylon.Scene/' + nodeId(mesh, mi);
      var meshNode = makeNode(mesh, 1, meshPath, null);
      if (meshNode) {
        var meshKids = traverseTransform(mesh, meshPath, 1);
        if (meshKids && meshKids.length > 0) meshNode.children = meshKids;
        sceneChildren.push(meshNode);
      }
    }
  }

  // TransformNodes (root-level ones not parented to a mesh)
  var tns = safeProp(scene, 'transformNodes', []);
  if (Array.isArray(tns)) {
    for (var ti = 0; ti < tns.length; ti++) {
      var tn = tns[ti];
      if (!tn) continue;
      var tnPath = 'Babylon.Scene/' + nodeId(tn, ti);
      var tnNode = makeNode(tn, 1, tnPath, 'TransformNode');
      if (tnNode) sceneChildren.push(tnNode);
    }
  }

  // Cameras
  var cams = safeProp(scene, 'cameras', []);
  if (Array.isArray(cams)) {
    for (var ci = 0; ci < cams.length; ci++) {
      var cam = cams[ci];
      if (!cam) continue;
      var camPath = 'Babylon.Scene/' + nodeId(cam, ci);
      // typeOverride null → makeNode falls back to getClassName() which returns
      // the specific camera subclass (ArcRotateCamera, FreeCamera, ...).
      var camNode = makeNode(cam, 1, camPath, null);
      if (camNode) sceneChildren.push(camNode);
    }
  }

  // Lights
  var lts = safeProp(scene, 'lights', []);
  if (Array.isArray(lts)) {
    for (var li = 0; li < lts.length; li++) {
      var light = lts[li];
      if (!light) continue;
      var lightPath = 'Babylon.Scene/' + nodeId(light, li);
      // typeOverride null → makeNode falls back to getClassName() which returns
      // the specific light subclass (HemisphericLight, DirectionalLight, ...).
      var lightNode = makeNode(light, 1, lightPath, null);
      if (lightNode) sceneChildren.push(lightNode);
    }
  }

  if (sceneNode) {
    if (sceneChildren.length > 0) sceneNode.children = sceneChildren;
  } else if (sceneChildren.length > 0) {
    sceneNode = sceneChildren[0];
  }

  return {
    engine: 'Babylon.js',
    version: version,
    canvas: canvasInfo,
    sceneTree: sceneNode,
    totalNodes: totalNodes,
    completeness: sceneNode ? 'full' : 'partial'
  };
})()`;
}

/**
 * Generates a self-contained JS string that:
 *  1. Transforms screen coordinates → canvas coordinates
 *  2. Uses scene.pick() (Babylon's native raycaster) when available
 *  3. Falls back to world-bounds DFS check
 *  4. Returns all candidates sorted by depth (topmost first)
 *
 * @param opts - Pick options (x, y, canvasId)
 */
export function buildBabylonHitTestPayload(opts: PickOpts): string {
  const x = opts.x;
  const y = opts.y;
  const canvasId = opts.canvasId;

  return `(function() {
  function safeProp(obj, key, fallback) {
    try { var v = obj[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function nodeId(node, idx) {
    try {
      if (node.uniqueId !== undefined && node.uniqueId !== null) return 'babylon_' + node.uniqueId;
    } catch(e) {}
    try {
      if (node.id !== undefined && node.id !== null && node.id !== '') return 'babylon_id_' + node.id;
    } catch(e) {}
    var name = node.name || (node.constructor ? node.constructor.name : 'BabylonNode');
    return String(name).replace(/\\s+/g, '_') + '_' + idx;
  }

  function getType(node) {
    try {
      var t = node.getClassName ? node.getClassName() : null;
      if (t) return t;
    } catch(e) {}
    return node.constructor ? node.constructor.name : 'BabylonNode';
  }

  function findScene() {
    var BABYLON = window.BABYLON;
    if (!BABYLON || !BABYLON.Engine) return null;
    var instances = BABYLON.Engine.Instances;
    if (instances && instances.length > 0) {
      for (var i = instances.length - 1; i >= 0; i--) {
        var engine = instances[i];
        if (engine && engine.scenes && engine.scenes.length > 0) {
          return engine.scenes[engine.scenes.length - 1];
        }
      }
    }
    try {
      var last = BABYLON.Engine.LastCreatedScene;
      if (last) return last;
    } catch(e) {}
    return null;
  }

  var sx = ${x}, sy = ${y};

  var canvases = Array.from(document.querySelectorAll('canvas'));
  var targetCanvas = null;
  ${
    canvasId
      ? `targetCanvas = document.getElementById(${JSON.stringify(canvasId)}) || canvases[parseInt(` +
        `${JSON.stringify(canvasId)})] || null;`
      : `
  for (var ci = canvases.length - 1; ci >= 0; ci--) {
    var r = canvases[ci].getBoundingClientRect();
    if (sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom) {
      targetCanvas = canvases[ci];
      break;
    }
  }`
  }

  if (!window.BABYLON || !window.BABYLON.Engine) {
    return { success: false, picked: null, candidates: [], coordinates: {
      screen: { x: sx, y: sy }, canvas: { x: sx, y: sy } }, hitTestMethod: 'none' };
  }

  var scene = findScene();
  if (!scene) {
    return { success: false, picked: null, candidates: [], coordinates: {
      screen: { x: sx, y: sy }, canvas: { x: sx, y: sy } }, hitTestMethod: 'none' };
  }

  var canvasX = sx, canvasY = sy;
  if (targetCanvas) {
    var rect = targetCanvas.getBoundingClientRect();
    canvasX = (sx - rect.left) * (targetCanvas.width / rect.width);
    canvasY = (sy - rect.top) * (targetCanvas.height / rect.height);
  }

  var candidates = [];
  var hitTestMethod = 'none';
  var enginePicked = null;

  // Try scene.pick() — Babylon's native raycast
  try {
    if (typeof scene.pick === 'function') {
      var pickInfo = scene.pick(canvasX, canvasY);
      if (pickInfo && pickInfo.hit && pickInfo.pickedMesh) {
        enginePicked = pickInfo.pickedMesh;
        hitTestMethod = 'engine';
      }
    }
  } catch(e) {}

  // DFS fallback over meshes using boundingInfo
  function meshBounds(mesh) {
    var pos = mesh.position || { x: 0, y: 0 };
    var scaling = mesh.scaling || { x: 1, y: 1 };
    try {
      var bi = mesh.getBoundingInfo ? mesh.getBoundingInfo() : null;
      if (bi && bi.boundingBox && bi.boundingBox.minimumWorld && bi.boundingBox.maximumWorld) {
        var mn = bi.boundingBox.minimumWorld;
        var mx = bi.boundingBox.maximumWorld;
        return { x: mn.x, y: mn.y, width: Math.abs(mx.x - mn.x), height: Math.abs(mx.y - mn.y) };
      }
    } catch(e) {}
    return { x: pos.x, y: pos.y, width: Math.abs(scaling.x), height: Math.abs(scaling.y) };
  }

  function hitTestDfs(node, depth, accPath) {
    if (!node) return;
    var visible = safeProp(node, 'isVisible', true);
    var enabled = safeProp(node, 'isEnabled', true);
    if (visible === false || enabled === false) return;

    var wb = meshBounds(node);
    if (wb.width > 0 && wb.height > 0) {
      var inBounds = canvasX >= wb.x && canvasX <= wb.x + wb.width &&
                     canvasY >= wb.y && canvasY <= wb.y + wb.height;
      var interactive = !!(safeProp(node, 'isPickable', true));
      if (inBounds && interactive) {
        candidates.push({
          node: {
            id: nodeId(node, 0),
            type: getType(node),
            name: safeProp(node, 'name', undefined) || undefined,
            visible: true,
            interactive: true,
            alpha: safeProp(node, 'alpha', 1),
            x: wb.x, y: wb.y,
            width: wb.width, height: wb.height,
            worldBounds: wb,
            path: accPath || nodeId(node, 0)
          },
          depth: depth
        });
      }
    }

    // Recurse into child meshes (Babylon meshes can have child meshes / transform nodes)
    try {
      var kids = node.getChildMeshes ? node.getChildMeshes(false) : null;
      if (kids && Array.isArray(kids)) {
        for (var i = 0; i < kids.length; i++) {
          var cm = kids[i];
          if (!cm) continue;
          var childPath = accPath ? accPath + '/' + nodeId(cm, i) : nodeId(cm, i);
          hitTestDfs(cm, depth + 1, childPath);
        }
      }
    } catch(e) {}
  }

  // Walk top-level meshes
  var meshes = safeProp(scene, 'meshes', []);
  if (Array.isArray(meshes)) {
    for (var mi = 0; mi < meshes.length; mi++) {
      var mesh = meshes[mi];
      if (!mesh) continue;
      // Skip meshes that have a parent — they'll be reached via DFS
      if (mesh.parent) continue;
      var meshPath = 'Babylon.Scene/' + nodeId(mesh, mi);
      hitTestDfs(mesh, 1, meshPath);
    }
  }

  var picked = enginePicked ? {
    id: nodeId(enginePicked, 0),
    type: getType(enginePicked),
    name: safeProp(enginePicked, 'name', undefined) || undefined,
    visible: !!(safeProp(enginePicked, 'isVisible', true)),
    interactive: !!(safeProp(enginePicked, 'isPickable', true)),
    alpha: safeProp(enginePicked, 'alpha', 1),
    x: meshBounds(enginePicked).x,
    y: meshBounds(enginePicked).y,
    width: meshBounds(enginePicked).width,
    height: meshBounds(enginePicked).height,
    worldBounds: meshBounds(enginePicked),
    path: 'Babylon.Scene/pick/' + nodeId(enginePicked, 0)
  } : null;

  if (!picked && candidates.length > 0) {
    candidates.sort(function(a, b) { return a.depth - b.depth; });
    picked = candidates[0].node;
    hitTestMethod = 'manual';
  }

  return {
    success: !!picked,
    picked: picked,
    candidates: candidates,
    coordinates: {
      screen: { x: sx, y: sy },
      canvas: { x: canvasX, y: canvasY }
    },
    hitTestMethod: hitTestMethod
  };
})()`;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

/**
 * Babylon.js canvas engine adapter.
 *
 * Detection checks window.BABYLON and Engine.Instances. dumpScene() walks
 * scene.meshes / transformNodes / cameras / lights. pickAt() uses scene.pick()
 * with DFS world-bounds fallback.
 */
export class BabylonCanvasAdapter implements CanvasEngineAdapter {
  readonly id = 'babylon';
  readonly engine = 'Babylon.js';
  readonly version: string | undefined;

  constructor() {
    this.version = undefined;
  }

  async detect(env: CanvasProbeEnv): Promise<CanvasDetection | null> {
    try {
      const result = await env.pageController.evaluate<{
        present: boolean;
        version?: string;
        hasScene: boolean;
      }>(`
        (function() {
          var BABYLON = window.BABYLON;
          if (!BABYLON || !BABYLON.Engine) return { present: false, hasScene: false };
          var version = BABYLON.Engine.Version || BABYLON.Engine.EngineVersion || undefined;
          var hasScene = false;
          var instances = BABYLON.Engine.Instances;
          if (instances && instances.length > 0) {
            for (var i = 0; i < instances.length; i++) {
              if (instances[i] && instances[i].scenes && instances[i].scenes.length > 0) {
                hasScene = true; break;
              }
            }
          }
          if (!hasScene) {
            try { if (BABYLON.Engine.LastCreatedScene) hasScene = true; } catch(e) {}
          }
          return { present: true, version: version, hasScene: hasScene };
        })()
      `);

      if (!result.present) return null;

      const evidence: string[] = ['window.BABYLON detected', 'BABYLON.Engine present'];
      if (result.version) evidence.push('Babylon version: ' + result.version);
      if (result.hasScene) {
        evidence.push('Scene reachable via Engine.Instances / LastCreatedScene');
      } else {
        evidence.push('No active scene found in Engine.Instances');
      }

      return {
        engine: this.engine,
        version: result.version,
        confidence: result.hasScene ? 0.95 : 0.9,
        evidence,
        adapterId: this.id,
      };
    } catch {
      return null;
    }
  }

  async dumpScene(env: CanvasProbeEnv, opts: DumpOpts): Promise<CanvasSceneDump> {
    const payload = buildBabylonSceneTreeDumpPayload(opts);
    const raw = await env.pageController.evaluate<{
      engine: string;
      version?: string;
      canvas: { width: number; height: number; dpr: number; contextType: string };
      sceneTree: CanvasSceneNode | null;
      totalNodes: number;
      completeness: string;
      error?: string;
    }>(payload);

    return {
      engine: raw.engine,
      version: raw.version,
      canvas: raw.canvas,
      sceneTree: raw.sceneTree ?? {
        id: 'empty',
        type: 'Scene',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: raw.canvas?.width ?? 0,
        height: raw.canvas?.height ?? 0,
        worldBounds: { x: 0, y: 0, width: raw.canvas?.width ?? 0, height: raw.canvas?.height ?? 0 },
        path: 'Babylon.Scene',
      },
      totalNodes: raw.totalNodes,
      completeness: raw.completeness === 'full' ? 'full' : 'partial',
    } as CanvasSceneDump;
  }

  async pickAt(env: CanvasProbeEnv, opts: PickOpts): Promise<CanvasPickResult> {
    const payload = buildBabylonHitTestPayload(opts);
    const result = await env.pageController.evaluate<{
      success: boolean;
      picked: CanvasSceneNode | null;
      candidates: Array<{ node: CanvasSceneNode; depth: number }>;
      coordinates: {
        screen: { x: number; y: number };
        canvas: { x: number; y: number };
      };
      hitTestMethod: CanvasHitTestMethod;
    }>(payload);

    return {
      success: result.success,
      picked: result.picked,
      candidates: result.candidates,
      coordinates: result.coordinates,
      hitTestMethod: result.hitTestMethod,
    } as CanvasPickResult;
  }
}
