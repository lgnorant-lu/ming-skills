/**
 * SkiaCaptureHandlers — facade for skia-capture domain tool handlers.
 *
 * Delegates to handlers/skia-detect.ts for actual implementation.
 */
import { ToolError } from '@errors/ToolError';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { PageController } from '@server/domains/shared/modules/collector';
import { detectRenderer, dumpScene, correlateObjects } from './skia-detect';
import type { JSObjectInfo } from '@modules/skia-capture/SkiaObjectCorrelator';
import type { EventBus, ServerEventMap } from '@server/EventBus';

export interface SkiaCaptureDomainDependencies {
  pageController: PageController | null;
  /** Optional: function to get JS objects from v8-inspector heap snapshot */
  getJSObjects?: () => JSObjectInfo[] | Promise<JSObjectInfo[]>;
  eventBus?: EventBus<ServerEventMap>;
}

export class SkiaCaptureHandlers {
  private deps: SkiaCaptureDomainDependencies;

  constructor(deps: SkiaCaptureDomainDependencies) {
    this.deps = deps;
  }

  async handleSkiaDetectRendererTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSkiaDetectRenderer(args));
  }

  async handleSkiaExtractSceneTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSkiaExtractScene(args));
  }

  async handleSkiaCorrelateObjectsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSkiaCorrelateObjects(args));
  }

  async handleSkiaDetectRenderer(args: Record<string, unknown>): Promise<unknown> {
    if (!this.deps.pageController) {
      throw new ToolError(
        'PREREQUISITE',
        'PageController not available — ensure browser is connected',
      );
    }
    return detectRenderer(this.deps.pageController, args);
  }

  async handleSkiaExtractScene(args: Record<string, unknown>): Promise<unknown> {
    if (!this.deps.pageController) {
      throw new ToolError(
        'PREREQUISITE',
        'PageController not available — ensure browser is connected',
      );
    }
    const result = await dumpScene(this.deps.pageController, args);
    const sceneTree = (result as Record<string, unknown>)?.sceneTree as
      | { layers?: unknown[]; drawCommands?: unknown[] }
      | undefined;
    if (sceneTree) {
      void this.deps.eventBus?.emit('skia:scene_captured', {
        canvasId: ((args as Record<string, unknown>).canvasId as string) ?? 'auto',
        nodeCount: (sceneTree.layers?.length ?? 0) + (sceneTree.drawCommands?.length ?? 0),
        timestamp: new Date().toISOString(),
      });
    }
    return result;
  }

  async handleSkiaCorrelateObjects(args: Record<string, unknown>): Promise<unknown> {
    if (!this.deps.pageController) {
      throw new ToolError(
        'PREREQUISITE',
        'PageController not available — ensure browser is connected',
      );
    }
    return correlateObjects(this.deps.pageController, args, this.deps.getJSObjects);
  }
}
