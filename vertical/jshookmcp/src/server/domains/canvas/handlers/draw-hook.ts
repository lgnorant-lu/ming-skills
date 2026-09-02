/**
 * canvas_inject_draw_hook — install / read / uninstall a draw-call interceptor.
 *
 * Wraps Canvas 2D (`drawImage` / `fillText` / `strokeText`) and WebGL
 * (`drawArrays` / `drawElements`) prototype methods, recording each invocation
 * into a ring buffer on `window.__jshookDrawLog`. Persistent mode re-injects
 * on every navigation via `Page.addScriptToEvaluateOnNewDocument`.
 *
 * Use case: obfuscated / VM-protected canvas games where the scene tree is
 * hidden — the only way to tell *what* is being rendered frame-by-frame is to
 * intercept the draw calls themselves.
 *
 * Timing mode (install with `timing: true`): additionally samples a
 * `requestAnimationFrame` loop into `window.__jshookFrameTimeline` (ring-buffer
 * capped at `maxFrames`, default 1800 ≈ 30s @ 60fps) so a follow-up `read` with
 * `includeTiming: true` can return frame-level stats (avg/p95 frame time,
 * dropped frames, 60fps budget misses) computed by the shared `computeFrameStats`
 * util. When the cap is reached the rAF loop self-stops and read reports
 * `stoppedReason: 'cap-reached'` — preventing both unbounded page-heap growth
 * and a runaway loop when the caller forgets to uninstall.
 *
 * Tamper resistance: this tool's typical target is an adversarial page that
 * may pre-declare `window.__jshookDrawHookInstalled = true` to silently disable
 * the hook. On install, if the installed flag is already set we verify the
 * saved originals are real functions and the prototypes are actually wrapped;
 * if verification fails we force-reinstall and report `reinstalled: true` so the
 * host can distinguish a genuine prior install from a page forgery.
 *
 * Academic basis: GPU Render-Timing CAPTCHA (arXiv 2607.23389, 2026-07) and
 * WebGPU-SPY (arXiv 2401.04349, 2024) establish that render timing is an
 * independent first-class signal; this hook surfaces the CPU-side frame timing
 * that a canvas game's draw-call stream implies.
 */
import type { ToolResponse } from '@server/types';
import { asJsonResponse } from '@server/domains/shared/response';
import { argBool, argNumber, argEnum } from '@server/domains/shared/parse-args';
import { computeFrameStats, type FrameTimingStats } from '@utils/FrameStats';
import type { PageController } from '@server/domains/canvas/dependencies';

const ACTIONS = new Set(['install', 'read', 'uninstall'] as const);

/** Default frame-timeline cap: ~30s of frames at 60fps. Bounds page-heap growth. */
const DEFAULT_MAX_FRAMES = 1800;

interface PersistentCapablePageController {
  evaluateOnNewDocument?(script: string): Promise<unknown>;
}

function buildInstallScript(maxEntries: number, timing: boolean, maxFrames: number): string {
  const cap = Math.max(1, Math.floor(maxEntries));
  const frameCap = Math.max(1, Math.floor(maxFrames));
  const timingHook = timing
    ? // rAF sampling loop into a ring buffer capped at frameCap. On reaching the
      // cap the loop self-stops (sets __jshookFrameStop + records stoppedReason)
      // so neither the array nor the rAF loop grows unbounded — defends against
      // both OOM and a forgotten uninstall.
      'if(!window.__jshookFrameTimeline){window.__jshookFrameTimeline=[];window.__jshookFrameIdx=0;window.__jshookFrameStop=false;window.__jshookFrameStoppedReason=null;}function sampleFrame(ts){if(window.__jshookFrameStop){return;}if(window.__jshookFrameTimeline.length>=' +
      frameCap +
      '){window.__jshookFrameStop=true;window.__jshookFrameStoppedReason="cap-reached";return;}var idx=window.__jshookFrameIdx;window.__jshookFrameIdx++;window.__jshookFrameTimeline.push({frameIndex:idx,frameStart:ts,frameEnd:null});window.__jshookLastRaf=window.requestAnimationFrame(sampleFrameEnd);}function sampleFrameEnd(){if(window.__jshookFrameStop){return;}var last=window.__jshookFrameTimeline[window.__jshookFrameTimeline.length-1];if(last){last.frameEnd=performance.now();}window.__jshookLastRaf=window.requestAnimationFrame(sampleFrame);}window.__jshookLastRaf=window.requestAnimationFrame(sampleFrame);'
    : '';
  return (
    '(function(){' +
    `var MAX=${cap};` +
    // Tamper check: if the installed flag is already true, verify the saved
    // originals are real functions AND the prototype is actually still wrapped
    // (orig.drawImage !== c2d.drawImage). A hostile page that merely pre-sets
    // __jshookDrawHookInstalled=true without real orig fails verification →
    // force reinstall and report reinstalled:true so the host knows.
    'if(window.__jshookDrawHookInstalled){var exOrig=window.__jshookDrawOrig||{};var c2dCheck=window.CanvasRenderingContext2D&&window.CanvasRenderingContext2D.prototype;var verified=typeof exOrig.drawImage==="function"&&c2dCheck&&exOrig.drawImage!==c2dCheck.drawImage;if(verified){return{installed:true,alreadyInstalled:true,entryCount:(window.__jshookDrawLog||[]).length};}window.__jshookDrawHookInstalled=false;var wasForged=true;}' +
    'var log=window.__jshookDrawLog||[];window.__jshookDrawLog=log;var orig=window.__jshookDrawOrig||{};var wrapped={};' +
    'function ser(args){var out=[];for(var i=0;i<Math.min(args.length,6);i++){var v=args[i];var t=typeof v;if(t==="string"){out.push(v.length>200?v.slice(0,200)+"…":v);}else if(t==="number"||t==="boolean"){out.push(v);}else if(v==null){out.push(null);}else{out.push("["+t+"]");}}return out;}' +
    'function record(kind,args,ctx){if(log.length>=MAX){log.shift();}var entry={kind:kind,args:ser(args),t:performance.now()};var canvas=ctx&&ctx.canvas;if(canvas&&canvas.id){entry.canvasId=canvas.id;}log.push(entry);}' +
    'var c2d=window.CanvasRenderingContext2D&&window.CanvasRenderingContext2D.prototype;' +
    'if(c2d){["drawImage","fillText","strokeText"].forEach(function(fn){if(typeof c2d[fn]!=="function"){return;}orig[fn]=c2d[fn];c2d[fn]=function(){try{record(fn,arguments,this);}catch(e){}return orig[fn].apply(this,arguments);};wrapped[fn]=c2d[fn];});}' +
    'function hookGL(Ctor,name){if(!Ctor||!Ctor.prototype){return;}var p=Ctor.prototype;["drawArrays","drawElements"].forEach(function(fn){if(typeof p[fn]!=="function"){return;}var key=name+"."+fn;orig[key]=p[fn];p[fn]=function(){try{record(fn,arguments,this);}catch(e){}return orig[key].apply(this,arguments);};wrapped[key]=p[fn];});}' +
    'hookGL(window.WebGLRenderingContext,"webgl");hookGL(window.WebGL2RenderingContext,"webgl2");' +
    'window.__jshookDrawOrig=orig;window.__jshookDrawWrapped=wrapped;window.__jshookDrawHookInstalled=true;' +
    timingHook +
    'return{installed:true,timing:' +
    (timing ? 'true' : 'false') +
    ',reinstalled:typeof wasForged!=="undefined"&&!!wasForged};' +
    '})()'
  );
}

function buildReadScript(clear: boolean, includeTiming: boolean): string {
  const timingRead = includeTiming
    ? // Build per-frame interval series from the timeline (the inter-frame
      // interval is frameStart[i] - frameStart[i-1]). Include the stoppedReason
      // so the host knows whether the cap terminated sampling.
      'var tl=window.__jshookFrameTimeline||[];var frameIntervals=[];for(var i=1;i<tl.length;i++){frameIntervals.push(tl[i].frameStart-tl[i-1].frameStart);}return{entries:copy,count:copy.length,installed:!!window.__jshookDrawHookInstalled,timing:{frames:tl,frameIntervals:frameIntervals,stoppedReason:window.__jshookFrameStoppedReason||null}};'
    : 'return{entries:copy,count:copy.length,installed:!!window.__jshookDrawHookInstalled};';
  return (
    '(function(){' +
    'var log=window.__jshookDrawLog||[];var copy=log.slice();' +
    `if(${clear}){log.length=0;}` +
    timingRead +
    '})()'
  );
}

function buildUninstallScript(): string {
  return (
    '(function(){' +
    'if(!window.__jshookDrawHookInstalled){return{uninstalled:false,notInstalled:true};}' +
    'var orig=window.__jshookDrawOrig||{};' +
    'var c2d=window.CanvasRenderingContext2D&&window.CanvasRenderingContext2D.prototype;' +
    // Detect whether the page rewrote a prototype during the hook lifetime
    // (anti-hook behavior). A wrapped fn reference is captured at install; if
    // the current prototype no longer equals it, the page tampered. Report the
    // list so the analyst knows the captured data may be incomplete.
    'var modified=[];' +
    'if(c2d){["drawImage","fillText","strokeText"].forEach(function(fn){var wrapped=window.__jshookDrawWrapped&&window.__jshookDrawWrapped[fn];if(wrapped&&c2d[fn]!==wrapped){modified.push(fn);}if(orig[fn]){c2d[fn]=orig[fn];}});}' +
    '["webgl","webgl2"].forEach(function(name){var Ctor=name==="webgl"?window.WebGLRenderingContext:window.WebGL2RenderingContext;var p=Ctor&&Ctor.prototype;if(!p){return;}["drawArrays","drawElements"].forEach(function(fn){var key=name+"."+fn;var wrapped=window.__jshookDrawWrapped&&window.__jshookDrawWrapped[key];if(wrapped&&p[fn]!==wrapped){modified.push(key);}if(orig[key]){p[fn]=orig[key];}});});' +
    'window.__jshookDrawHookInstalled=false;' +
    // Stop the timing rAF loop if it was running and clear the timeline.
    'if(window.__jshookLastRaf&&window.cancelAnimationFrame){window.__jshookFrameStop=true;window.cancelAnimationFrame(window.__jshookLastRaf);window.__jshookLastRaf=null;}' +
    // Reset timing state so a subsequent install can start a fresh sampling
    // window (without this, the cap-reached stop flag survives uninstall and
    // blocks the next install's rAF loop from ever starting).
    'if(window.__jshookFrameTimeline){window.__jshookFrameTimeline.length=0;window.__jshookFrameIdx=0;window.__jshookFrameStop=false;window.__jshookFrameStoppedReason=null;}' +
    'return{uninstalled:true,prototypeModifiedDuringHook:modified};' +
    '})()'
  );
}

export async function handleDrawHook(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const action = argEnum(args, 'action', ACTIONS, 'install');
  const persistent = argBool(args, 'persistent', false);
  const maxEntries = argNumber(args, 'maxEntries', 1000);
  const maxFrames = argNumber(args, 'maxFrames', DEFAULT_MAX_FRAMES);
  const clear = argBool(args, 'clear', false);
  const timing = argBool(args, 'timing', false);
  const includeTiming = argBool(args, 'includeTiming', false);

  try {
    if (action === 'install') {
      const script = buildInstallScript(maxEntries, timing, maxFrames);
      const persistentCapable = pageController as unknown as PersistentCapablePageController;
      const persistentApplied =
        persistent && typeof persistentCapable.evaluateOnNewDocument === 'function';
      if (persistentApplied) {
        await persistentCapable.evaluateOnNewDocument!(script);
      }
      let result: Record<string, unknown>;
      try {
        result = await pageController.evaluate<Record<string, unknown>>(script);
      } catch (error) {
        // N4: persistent registered but the current-page evaluate failed —
        // surface the partial state so the caller isn't left guessing whether
        // the hook is active on the current page.
        if (persistentApplied) {
          return asJsonResponse({
            action: 'install',
            persistent: true,
            timing,
            success: false,
            partialInstall: true,
            reason:
              'persistent registered via evaluateOnNewDocument but current-page evaluate failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
      return asJsonResponse({
        action: 'install',
        persistent: persistentApplied,
        timing,
        ...result,
        ...(persistent && !persistentApplied
          ? {
              persistentNote:
                'evaluateOnNewDocument unavailable on this controller; hook installed for the current page only',
            }
          : {}),
      });
    }

    if (action === 'read') {
      const result = await pageController.evaluate<
        Record<string, unknown> & {
          timing?: {
            frames: Array<{ frameIndex: number; frameStart: number; frameEnd: number | null }>;
            frameIntervals: number[];
            stoppedReason: string | null;
          };
        }
      >(buildReadScript(clear, includeTiming));

      // Compute frame stats host-side from the inter-frame intervals. precision
      // is 'cpu-roundtrip' (no GPU timestamp queries available from JS), so
      // cpuOrGpuBound will be 'unknown' — the value of the frame stats here is
      // the dropped-frame / budget-miss detection, not CPU/GPU attribution.
      let stats: FrameTimingStats | undefined;
      if (includeTiming && result.timing && result.timing.frameIntervals.length > 0) {
        stats = computeFrameStats(result.timing.frameIntervals, [], 'cpu-roundtrip');
      }

      return asJsonResponse({
        action: 'read',
        clear,
        ...result,
        ...(stats ? { frameStats: stats } : {}),
        ...(includeTiming && !result.timing
          ? { timingNote: 'timing was not enabled at install time; no frame timeline available' }
          : {}),
      });
    }

    const result = await pageController.evaluate<Record<string, unknown>>(buildUninstallScript());
    return asJsonResponse({ action: 'uninstall', ...result });
  } catch (error) {
    return asJsonResponse({
      action,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
