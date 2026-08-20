import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { R } from '@server/domains/shared/ResponseBuilder';
import { ReverseSessionHandlers } from '@server/reverse-session/ReverseSessionHandlers';

function parse<T>(response: unknown): T {
  return R.parse(response as Parameters<typeof R.parse>[0]);
}

describe('ReverseSessionHandlers', () => {
  it('creates a recoverable reverse session with cross-domain planned steps', async () => {
    const handlers = new ReverseSessionHandlers();
    const body = parse<any>(
      await handlers.handleReverseSession({
        action: 'create',
        platform: 'android',
        packageName: 'com.example.app',
        apkPath: 'C:/samples/app.apk',
        pid: 1234,
        artifactRoot: 'artifacts/sessions/rev-1',
      }),
    );

    expect(body.success).toBe(true);
    expect(body.session.target).toMatchObject({
      platform: 'android',
      packageName: 'com.example.app',
      apkPath: 'C:/samples/app.apk',
      pid: 1234,
    });
    expect(body.session.artifactRoot).toBe('artifacts/sessions/rev-1');
    expect(body.session.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'apk-intake', tool: 'apk_dex_intake', status: 'ready' }),
        expect.objectContaining({ id: 'frida-dex-dump', tool: 'frida_dex_dump' }),
        expect.objectContaining({
          id: 'runtime-dump-session',
          tool: 'android_runtime_dump_session',
        }),
        expect.objectContaining({ id: 'transform-workbench', tool: 'transform_workbench' }),
      ]),
    );

    const status = parse<any>(
      await handlers.handleReverseSession({
        action: 'status',
        sessionId: body.session.sessionId,
      }),
    );
    expect(status.success).toBe(true);
    expect(status.session.sessionId).toBe(body.session.sessionId);
  });

  it('previews a plan without storing a session', async () => {
    const handlers = new ReverseSessionHandlers();
    const body = parse<any>(
      await handlers.handleReverseSession({
        action: 'plan',
        packageName: 'com.example.app',
      }),
    );

    expect(body.success).toBe(true);
    expect(body.plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'apk-intake',
          status: 'blocked',
          reason: expect.stringContaining('apkPath'),
        }),
      ]),
    );
    expect(parse<any>(await handlers.handleReverseSession({ action: 'list' })).count).toBe(0);
  });

  it('runs executable planned steps through an injected tool executor and records evidence refs', async () => {
    const executor = vi.fn(async (tool: string, args: Record<string, unknown>) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            tool,
            args,
            artifact: { kind: `${tool}-artifact` },
          }),
        },
      ],
    }));
    const handlers = new ReverseSessionHandlers(executor);
    const created = parse<any>(
      await handlers.handleReverseSession({
        action: 'create',
        platform: 'android',
        packageName: 'com.example.app',
        apkPath: 'C:/samples/app.apk',
        pid: 1234,
        artifactRoot: 'artifacts/sessions/rev-1',
      }),
    );

    const run = parse<any>(
      await handlers.handleReverseSession({
        action: 'run',
        sessionId: created.session.sessionId,
        maxSteps: 3,
      }),
    );

    expect(run.success).toBe(true);
    expect(executor.mock.calls.map((call) => call[0])).toEqual([
      'apk_dex_intake',
      'frida_dex_dump',
      'android_runtime_dump_session',
    ]);
    expect(run.run).toMatchObject({
      status: 'partial',
      executedSteps: [
        { stepId: 'apk-intake', tool: 'apk_dex_intake', success: true },
        { stepId: 'frida-dex-dump', tool: 'frida_dex_dump', success: true },
        { stepId: 'runtime-dump-session', tool: 'android_runtime_dump_session', success: true },
      ],
    });
    expect(run.session.evidenceRefs).toHaveLength(3);
    expect(run.session.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'apk-intake', status: 'completed' }),
        expect.objectContaining({ id: 'frida-dex-dump', status: 'completed' }),
        expect.objectContaining({ id: 'runtime-dump-session', status: 'completed' }),
        expect.objectContaining({ id: 'transform-workbench', status: 'blocked' }),
      ]),
    );
  });

  it('promotes dumped artifacts into transform workbench input during a run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jshook-reverse-session-'));
    try {
      const outputDir = join(root, 'dumped');
      const artifactPath = join(outputDir, 'classes.dex');
      await mkdir(outputDir, { recursive: true });
      await writeFile(artifactPath, Buffer.from('dex\n035\0artifact', 'ascii'));

      const executor = vi.fn(async (tool: string, args: Record<string, unknown>) => {
        if (tool === 'frida_dex_dump') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  outputDir,
                  dumpedFiles: ['classes.dex'],
                  count: 1,
                }),
              },
            ],
          };
        }
        if (tool === 'android_runtime_dump_session') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  outputDir,
                  evidence: { dumpedDex: { count: 1, files: [{ path: 'classes.dex' }] } },
                }),
              },
            ],
          };
        }
        if (tool === 'transform_workbench') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  artifact: { kind: 'transform-workbench-artifact' },
                  inputSize: Buffer.from(String(args['inputBase64']), 'base64').length,
                }),
              },
            ],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
        };
      });
      const handlers = new ReverseSessionHandlers(executor);
      const created = parse<any>(
        await handlers.handleReverseSession({
          action: 'create',
          packageName: 'com.example.app',
          apkPath: 'C:/samples/app.apk',
          artifactRoot: root,
        }),
      );

      const run = parse<any>(
        await handlers.handleReverseSession({
          action: 'run',
          sessionId: created.session.sessionId,
          maxSteps: 4,
        }),
      );

      const transformedCall = executor.mock.calls.find((call) => call[0] === 'transform_workbench');
      expect(transformedCall).toBeDefined();
      expect(transformedCall?.[1]).toMatchObject({
        inputBase64: (await readFile(artifactPath)).toString('base64'),
        steps: [{ op: 'entropy' }],
      });
      expect(run.run.executedSteps.map((step: { tool: string }) => step.tool)).toEqual([
        'apk_dex_intake',
        'frida_dex_dump',
        'android_runtime_dump_session',
        'transform_workbench',
      ]);
      expect(run.session.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'transform-workbench', status: 'completed' }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not inline-promote oversized dumped artifacts into transform input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jshook-reverse-session-'));
    try {
      const outputDir = join(root, 'dumped');
      const artifactPath = join(outputDir, 'classes.dex');
      await mkdir(outputDir, { recursive: true });
      await writeFile(artifactPath, Buffer.from('dex\n035\0', 'ascii'));
      await truncate(artifactPath, 17 * 1024 * 1024);

      const executor = vi.fn(async (tool: string) => {
        if (tool === 'frida_dex_dump' || tool === 'android_runtime_dump_session') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  outputDir,
                  dumpedFiles: ['classes.dex'],
                  count: 1,
                }),
              },
            ],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
        };
      });
      const handlers = new ReverseSessionHandlers(executor);
      const created = parse<any>(
        await handlers.handleReverseSession({
          action: 'create',
          packageName: 'com.example.app',
          apkPath: 'C:/samples/app.apk',
          artifactRoot: root,
        }),
      );

      const run = parse<any>(
        await handlers.handleReverseSession({
          action: 'run',
          sessionId: created.session.sessionId,
          maxSteps: 4,
        }),
      );

      expect(executor.mock.calls.some((call) => call[0] === 'transform_workbench')).toBe(false);
      expect(run.session.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'transform-workbench',
            status: 'blocked',
            reason: expect.stringContaining('too large'),
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('treats MCP isError text responses as failed tool executions', async () => {
    const executor = vi.fn(async () => ({
      isError: true,
      content: [{ type: 'text', text: 'tool failed before JSON output' }],
    }));
    const handlers = new ReverseSessionHandlers(executor);
    const created = parse<any>(
      await handlers.handleReverseSession({
        action: 'create',
        apkPath: 'C:/samples/app.apk',
      }),
    );

    const body = parse<any>(
      await handlers.handleReverseSession({
        action: 'run',
        sessionId: created.session.sessionId,
      }),
    );

    expect(body.success).toBe(false);
    expect(body.run.status).toBe('failed');
    expect(body.run.executedSteps[0]).toMatchObject({
      stepId: 'apk-intake',
      tool: 'apk_dex_intake',
      success: false,
      error: 'tool failed before JSON output',
    });
    expect(body.session.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'apk-intake', status: 'failed' })]),
    );
  });

  it('does not fake a reverse-session run when no tool executor is available', async () => {
    const handlers = new ReverseSessionHandlers();
    const created = parse<any>(
      await handlers.handleReverseSession({
        action: 'create',
        apkPath: 'C:/samples/app.apk',
      }),
    );

    const body = parse<any>(
      await handlers.handleReverseSession({
        action: 'run',
        sessionId: created.session.sessionId,
      }),
    );

    expect(body.success).toBe(false);
    expect(body.reason).toContain('tool executor');
    expect(body.session.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'apk-intake', status: 'ready' })]),
    );
  });
});
