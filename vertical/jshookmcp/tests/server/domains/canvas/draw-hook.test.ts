import { describe, expect, it, vi } from 'vitest';
import { handleDrawHook } from '@server/domains/canvas/handlers/draw-hook';

function parseJson(res: unknown): Record<string, unknown> {
  const r = res as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock controller
function makePageController(withPersistent = true): any {
  const pc: any = { evaluate: vi.fn() };
  if (withPersistent) {
    pc.evaluateOnNewDocument = vi.fn();
  }
  return pc;
}

describe('handleDrawHook', () => {
  it('installs the hook on the current page (non-persistent)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ installed: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'install' }));

    expect(json.action).toBe('install');
    expect(json.installed).toBe(true);
    expect(json.persistent).toBe(false);
    expect(pc.evaluate).toHaveBeenCalledTimes(1);
    expect(pc.evaluateOnNewDocument).not.toHaveBeenCalled();
    // install script wraps the Canvas 2D + WebGL draw methods
    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('drawImage');
    expect(script).toContain('drawArrays');
    expect(script).toContain('__jshookDrawLog');
  });

  it('installs persistently via evaluateOnNewDocument', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ installed: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'install', persistent: true }));

    expect(json.persistent).toBe(true);
    expect(pc.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
    expect(pc.evaluate).toHaveBeenCalledTimes(1);
  });

  it('honors maxEntries in the generated install script', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ installed: true });

    await handleDrawHook(pc, { action: 'install', maxEntries: 5000 });

    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('MAX=5000');
  });

  it('reads captured entries from the ring buffer', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      entries: [{ kind: 'drawImage', args: ['bg.png'], t: 1 }],
      count: 1,
      installed: true,
    });

    const json = parseJson(await handleDrawHook(pc, { action: 'read' }));

    expect(json.action).toBe('read');
    expect(json.count).toBe(1);
    expect(json.entries).toHaveLength(1);
    expect(json.installed).toBe(true);
  });

  it('forwards the clear flag on read', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ entries: [], count: 0, installed: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'read', clear: true }));

    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('if(true){log.length=0;}');
    expect(json.clear).toBe(true);
  });

  it('uninstalls the hook', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ uninstalled: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'uninstall' }));

    expect(json.action).toBe('uninstall');
    expect(json.uninstalled).toBe(true);
    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('__jshookDrawHookInstalled=false');
  });

  it('degrades honestly when the controller lacks evaluateOnNewDocument', async () => {
    const pc = makePageController(false); // no evaluateOnNewDocument
    pc.evaluate.mockResolvedValueOnce({ installed: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'install', persistent: true }));

    expect(json.persistent).toBe(false);
    expect(json.persistentNote).toContain('unavailable');
  });

  it('wraps unexpected errors', async () => {
    const pc = makePageController();
    pc.evaluate.mockRejectedValueOnce(new Error('page gone'));

    const json = parseJson(await handleDrawHook(pc, { action: 'read' }));

    expect(json.success).toBe(false);
    expect(json.error).toBe('page gone');
  });

  // ── Timing mode ────────────────────────────────────────────────────────────

  it('injects the rAF sampler when timing=true at install', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ installed: true, timing: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'install', timing: true }));

    expect(json.timing).toBe(true);
    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('__jshookFrameTimeline');
    expect(script).toContain('requestAnimationFrame');
  });

  it('omits the rAF sampler when timing is not set (default false)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ installed: true });

    await handleDrawHook(pc, { action: 'install' });

    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).not.toContain('__jshookFrameTimeline');
  });

  it('computes frame stats from inter-frame intervals on read with includeTiming', async () => {
    const pc = makePageController();
    // Simulate a page that was installed with timing and produced 4 frames:
    // starts at 0, 16, 33, 50 → intervals [16, 17, 17] (one >16.67 budget miss).
    pc.evaluate.mockResolvedValueOnce({
      entries: [],
      count: 0,
      installed: true,
      timing: {
        frames: [
          { frameIndex: 0, frameStart: 0, frameEnd: 5 },
          { frameIndex: 1, frameStart: 16, frameEnd: 21 },
          { frameIndex: 2, frameStart: 33, frameEnd: 38 },
          { frameIndex: 3, frameStart: 50, frameEnd: 55 },
        ],
        frameIntervals: [16, 17, 17],
      },
    });

    const json = parseJson(await handleDrawHook(pc, { action: 'read', includeTiming: true }));

    expect(json.action).toBe('read');
    expect(json.timing).toBeDefined();
    expect(json.frameStats).toBeDefined();
    const stats = json.frameStats as {
      frameCount: number;
      precision: string;
      budgetMisses: number;
    };
    expect(stats.precision).toBe('cpu-roundtrip');
    expect(stats.frameCount).toBe(3); // 3 inter-frame intervals
    // 17ms exceeds the 16.67ms 60fps budget → 2 budget misses (the two 17s)
    expect(stats.budgetMisses).toBe(2);
  });

  it('degrades honestly when includeTiming is requested but timing was not enabled', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ entries: [], count: 0, installed: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'read', includeTiming: true }));

    expect(json.timingNote).toContain('not enabled');
    expect(json.frameStats).toBeUndefined();
  });

  it('uninstall stops the rAF sampler and clears timing state', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ uninstalled: true });

    await handleDrawHook(pc, { action: 'uninstall' });

    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('__jshookFrameStop=true');
    expect(script).toContain('cancelAnimationFrame');
  });

  // ── Tamper resistance & bounds (reviewer BLOCKING fixes) ───────────────────

  it('caps the frame timeline to prevent unbounded page-heap growth (B1+B2)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ installed: true, timing: true });

    await handleDrawHook(pc, { action: 'install', timing: true, maxFrames: 500 });

    const script = pc.evaluate.mock.calls[0][0] as string;
    // The rAF sampler must check the cap and self-stop, recording a reason.
    expect(script).toContain('__jshookFrameTimeline.length>=500');
    expect(script).toContain('__jshookFrameStop=true');
    expect(script).toContain('__jshookFrameStoppedReason="cap-reached"');
  });

  it('reports the cap-reached stoppedReason on read (B1+B2)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      entries: [],
      count: 0,
      installed: true,
      timing: {
        frames: [],
        frameIntervals: [],
        stoppedReason: 'cap-reached',
      },
    });

    const json = parseJson(await handleDrawHook(pc, { action: 'read', includeTiming: true }));

    expect(json.timing).toBeDefined();
    expect((json.timing as { stoppedReason: string }).stoppedReason).toBe('cap-reached');
  });

  it('force-reinstalls when the installed flag is forged without real originals (B3)', async () => {
    const pc = makePageController();
    // Simulate a hostile page: installed flag true but no real orig/wrap →
    // verification fails → force reinstall.
    pc.evaluate.mockResolvedValueOnce({ installed: true, timing: false, reinstalled: true });

    const json = parseJson(await handleDrawHook(pc, { action: 'install' }));

    const script = pc.evaluate.mock.calls[0][0] as string;
    // Install must verify orig is a real function AND prototype is actually wrapped.
    expect(script).toContain('typeof exOrig.drawImage==="function"');
    expect(script).toContain('exOrig.drawImage!==c2dCheck.drawImage');
    // On verification failure it must clear the flag and proceed to reinstall.
    expect(script).toContain('window.__jshookDrawHookInstalled=false;var wasForged=true');
    expect(json.reinstalled).toBe(true);
  });

  it('reports prototype tampering detected during uninstall (N1)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      uninstalled: true,
      prototypeModifiedDuringHook: ['drawImage'],
    });

    const json = parseJson(await handleDrawHook(pc, { action: 'uninstall' }));

    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('__jshookDrawWrapped');
    expect(json.prototypeModifiedDuringHook).toEqual(['drawImage']);
  });

  it('uninstall resets timing state so a later install can restart sampling', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ uninstalled: true });

    await handleDrawHook(pc, { action: 'uninstall' });

    const script = pc.evaluate.mock.calls[0][0] as string;
    // Cap-reached stop flag must not survive uninstall, or the next install's
    // rAF loop never starts.
    expect(script).toContain('__jshookFrameTimeline.length=0');
    expect(script).toContain('__jshookFrameStop=false');
    expect(script).toContain('__jshookFrameStoppedReason=null');
  });

  it('uninstall tamper detection covers WebGL prototypes too', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({ uninstalled: true, prototypeModifiedDuringHook: [] });

    await handleDrawHook(pc, { action: 'uninstall' });

    const script = pc.evaluate.mock.calls[0][0] as string;
    // WebGL branch must also compare wrapped references, keyed by "webgl.drawArrays" etc.
    expect(script).toContain('window.__jshookDrawWrapped&&window.__jshookDrawWrapped[key]');
  });
});
