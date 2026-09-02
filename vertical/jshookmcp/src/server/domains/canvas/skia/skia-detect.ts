/**
 * Skia renderer detection and scene dump handlers.
 *
 * Implements SKIA-01 (detectSkiaRenderer) and SKIA-02 (extractSceneTree).
 * Integrates with v8-inspector domain for SKIA-03 (correlateObjects).
 */
import { ToolError } from '@errors/ToolError';
import { argString, argBool, argStringArray } from '@server/domains/shared/parse-args';
import type { PageController } from '@server/domains/shared/modules/collector';
import { detectSkiaRenderer, extractSceneTree } from '@modules/skia-capture/SkiaSceneExtractor';
import { correlateToJS } from '@modules/skia-capture/SkiaObjectCorrelator';
import type { JSObjectInfo } from '@modules/skia-capture/SkiaObjectCorrelator';

/**
 * Build the NOT_FOUND ToolError shared by SKIA-02/SKIA-03 when the active
 * canvas engine exposes no Skia scene graph. Only the operation noun differs
 * between the two call sites; the canvasId suffix and reason are identical.
 */
function unsupportedSceneError(operation: string, canvasId: string | undefined): ToolError {
  return new ToolError(
    'NOT_FOUND',
    `Skia ${operation} is not supported for the active canvas engine (canvasId=${
      canvasId || 'auto'
    }); no Skia scene graph is exposed via the DOM`,
  );
}

/**
 * Handler for skia_detect_renderer (SKIA-01).
 */
export async function detectRenderer(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<unknown> {
  const canvasId = argString(args, 'canvasId');
  const rendererInfo = await detectSkiaRenderer(pageController, canvasId || undefined);

  return {
    rendererInfo,
    canvasId: canvasId || 'auto',
    detectionComplete: true,
  };
}

/**
 * Handler for skia_dump_scene (SKIA-02).
 */
export async function dumpScene(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<unknown> {
  const canvasId = argString(args, 'canvasId');
  const includeDrawCommands = argBool(args, 'includeDrawCommands', true);

  const sceneTree = await extractSceneTree(
    pageController,
    canvasId || undefined,
    includeDrawCommands,
  );

  if (sceneTree.unsupported) {
    throw unsupportedSceneError('scene extraction', canvasId);
  }

  return {
    sceneTree,
    canvasId: canvasId || 'auto',
    extractionComplete: true,
  };
}

/**
 * Handler for skia_correlate_objects (SKIA-03).
 *
 * Cross-domain: requires v8-inspector for JS object data.
 */
export async function correlateObjects(
  pageController: PageController,
  args: Record<string, unknown>,
  getJSObjects?: () => JSObjectInfo[] | Promise<JSObjectInfo[]>,
): Promise<unknown> {
  const canvasId = argString(args, 'canvasId');
  const skiaNodeIds = argStringArray(args, 'skiaNodeIds');

  // Extract Skia scene
  const sceneTree = await extractSceneTree(pageController, canvasId || undefined, true);

  if (sceneTree.unsupported) {
    throw unsupportedSceneError('object correlation', canvasId);
  }

  if (sceneTree.layers.length === 0 && sceneTree.drawCommands.length === 0) {
    throw new ToolError(
      'PREREQUISITE',
      `No Skia scene data available for correlation (canvasId=${canvasId || 'auto'})`,
    );
  }

  // Get JS objects from v8-inspector if available — degrade gracefully, but
  // surface the failure so 'no correlations' is distinguishable from a
  // v8-inspector integration error.
  let jsObjects: JSObjectInfo[] = [];
  let jsObjectsWarning: string | undefined;
  if (getJSObjects) {
    try {
      jsObjects = await getJSObjects();
    } catch (err) {
      jsObjects = [];
      jsObjectsWarning = `v8-inspector JS object fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  // Filter Skia objects by node IDs if provided
  let targetSceneTree = sceneTree;
  if (skiaNodeIds.length > 0) {
    const idSet = new Set(skiaNodeIds);
    targetSceneTree = {
      ...sceneTree,
      layers: sceneTree.layers.filter((l) => idSet.has(l.id)),
      drawCommands: sceneTree.drawCommands.filter((cmd) => {
        const id = cmd.layerId;
        return id === undefined || idSet.has(id);
      }),
    };
  }

  const result = correlateToJS(targetSceneTree, jsObjects);

  return {
    correlations: result,
    canvasId: canvasId || 'auto',
    skiaNodeIds: skiaNodeIds.length > 0 ? skiaNodeIds : undefined,
    correlationComplete: true,
    ...(jsObjectsWarning ? { warning: jsObjectsWarning } : {}),
  };
}
