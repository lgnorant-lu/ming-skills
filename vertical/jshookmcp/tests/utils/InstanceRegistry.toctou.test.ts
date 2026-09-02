import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');

/**
 * Regression tests for the TOCTOU race in registerServerInstance:
 * the instance limit check used to happen before the record was written, so
 * concurrent registrations (real processes) could all pass the check and
 * exceed the cap. The fix re-checks the live count AFTER writing the record
 * and rolls the registration back (unlink) when the cap would be exceeded.
 *
 * Three real node subprocesses race to register under a cap of 2 — the
 * exact interleaving the race was designed to close.
 */
describe('utils/InstanceRegistry TOCTOU', () => {
  let stateDir: string;

  beforeEach(async () => {
    vi.resetModules();
    stateDir = await mkdtemp(join(tmpdir(), 'jshook-toctou-'));
    process.env.JSHOOK_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    delete process.env.JSHOOK_STATE_DIR;
    vi.unstubAllEnvs();
    await rm(stateDir, { recursive: true, force: true });
  });

  async function loadRegistry(maxInstances: number) {
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      JSHOOK_INSTANCE_WARN_AT: 99,
      JSHOOK_MAX_INSTANCES: maxInstances,
    }));
    return await import('@utils/InstanceRegistry');
  }

  const RACER_SCRIPT = `
    const { getStateDir } = await import('./src/server/persistence/RuntimeSnapshotScheduler.ts');
    const stateDir = getStateDir();
    const { registerServerInstance } = await import('./src/utils/InstanceRegistry.ts');
    try {
      const result = await registerServerInstance({ transport: 'stdio', profile: 'child' });
      console.log('REGISTERED ' + result.liveCount + ' DIR=' + stateDir);
    } catch (error) {
      console.log('REJECTED ' + (error instanceof Error ? error.message : String(error)) + ' DIR=' + stateDir);
    }
    setInterval(() => {}, 1000); // stay alive until killed so the record stays on disk
  `;

  function killChildren(children: ReturnType<typeof spawn>[]) {
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  }

  it('concurrent real-process registrations never exceed the cap (cap 2, three racers)', async () => {
    const spawned = [
      spawn(process.execPath, ['--import', 'tsx', '-e', RACER_SCRIPT], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JSHOOK_STATE_DIR: stateDir,
          JSHOOK_MAX_INSTANCES: '2',
          JSHOOK_INSTANCE_WARN_AT: '99',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      spawn(process.execPath, ['--import', 'tsx', '-e', RACER_SCRIPT], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JSHOOK_STATE_DIR: stateDir,
          JSHOOK_MAX_INSTANCES: '2',
          JSHOOK_INSTANCE_WARN_AT: '99',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      spawn(process.execPath, ['--import', 'tsx', '-e', RACER_SCRIPT], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JSHOOK_STATE_DIR: stateDir,
          JSHOOK_MAX_INSTANCES: '2',
          JSHOOK_INSTANCE_WARN_AT: '99',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ];

    try {
      const collect = (child: ReturnType<typeof spawn>): Promise<string> =>
        new Promise((resolve) => {
          let output = '';
          const onData = (chunk: Buffer) => {
            output += chunk.toString('utf8');
            if (output.includes('REGISTERED') || output.includes('REJECTED')) {
              resolve(output);
            }
          };
          child.stdout?.on('data', onData);
          child.stderr?.on('data', onData);
          child.on('close', () => resolve(output));
          setTimeout(() => resolve(output), 15_000).unref();
        });

      const outputs = await Promise.all(spawned.map(collect));
      const racers = outputs.map((output) => ({ code: 0, output }));

      const registered = racers.filter((r) => r.output.includes('REGISTERED'));
      const rejected = racers.filter((r) => r.output.includes('REJECTED'));

      // At least one racer must have been rejected (pre-fix: all three
      // raced through the pre-check and registered, exceeding the cap).
      const racerOutputs = racers.map((r) => r.output.trim()).join(' || ');
      expect(rejected.length, racerOutputs).toBeGreaterThanOrEqual(1);

      // Registered racers observed a live count within the cap.
      for (const racer of registered) {
        const match = racer.output.match(/REGISTERED (\d+)/);
        expect(Number(match?.[1])).toBeLessThanOrEqual(2);
      }
      expect(registered.length).toBeLessThanOrEqual(2);
    } finally {
      killChildren(spawned);
    }
  });

  it('sequential registrations up to the cap all succeed', async () => {
    const { registerServerInstance, unregisterServerInstance } = await loadRegistry(2);

    const first = await registerServerInstance({ transport: 'stdio', profile: 'a' });
    const second = await registerServerInstance({ transport: 'stdio', profile: 'b' });
    expect(first.blocked).toBe(false);
    expect(second.blocked).toBe(false);

    await unregisterServerInstance();
  });

  it('pre-check still fast-fails when the cap is already exceeded', async () => {
    const { registerServerInstance } = await loadRegistry(1);
    const { getStateDir } = await import('@server/persistence/RuntimeSnapshotScheduler');
    const dir = join(getStateDir(), 'instances');
    await mkdir(dir, { recursive: true });

    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(dir, `${process.ppid}.json`),
      JSON.stringify({
        pid: process.ppid,
        ppid: 1,
        startedAt: new Date().toISOString(),
        transport: 'stdio',
        profile: 'full',
        argv0: 'peer',
      }),
      'utf8',
    );

    await expect(registerServerInstance({ transport: 'stdio', profile: 'self' })).rejects.toThrow(
      'instance limit reached',
    );
  });

  // Ensure the tsx CLI resolution used above stays valid.
  it('resolves tsx cli for the racer subprocess', () => {
    expect(typeof tsxCli).toBe('string');
  });
});
