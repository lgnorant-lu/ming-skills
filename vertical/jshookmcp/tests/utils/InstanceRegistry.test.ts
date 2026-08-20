import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('utils/InstanceRegistry', () => {
  let stateDir: string;

  beforeEach(async () => {
    vi.resetModules();
    stateDir = await mkdtemp(join(tmpdir(), 'jshook-state-'));
    process.env.JSHOOK_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    delete process.env.JSHOOK_STATE_DIR;
    vi.unstubAllEnvs();
    await rm(stateDir, { recursive: true, force: true });
  });

  it('registers and explicitly unregisters the current server process', async () => {
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      JSHOOK_INSTANCE_WARN_AT: 99,
      JSHOOK_MAX_INSTANCES: 0,
    }));
    const { listLiveInstances, registerServerInstance, unregisterServerInstance } =
      await import('@utils/InstanceRegistry');

    const result = await registerServerInstance({ transport: 'stdio', profile: 'workflow' });
    expect(result).toMatchObject({ liveCount: 1, warned: false, blocked: false });
    expect(result.self).toMatchObject({
      pid: process.pid,
      transport: 'stdio',
      profile: 'workflow',
    });
    expect(await listLiveInstances(process.pid)).toEqual([]);

    await unregisterServerInstance();
  });

  it('reaps malformed and stale records', async () => {
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      JSHOOK_INSTANCE_WARN_AT: 99,
      JSHOOK_MAX_INSTANCES: 0,
    }));
    const { getStateDir } = await import('@server/persistence/RuntimeSnapshotScheduler');
    const dir = join(getStateDir(), 'instances');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'broken.json'), '{not-json', 'utf8');
    const deadPid = 2_147_483_646;
    await writeFile(
      join(dir, `${deadPid}.json`),
      JSON.stringify({
        pid: deadPid,
        ppid: 1,
        startedAt: new Date().toISOString(),
        transport: 'stdio',
        profile: 'search',
        argv0: 'dead',
      }),
      'utf8',
    );

    const { listLiveInstances } = await import('@utils/InstanceRegistry');
    expect(await listLiveInstances(process.pid)).toEqual([]);
  });

  it('warns at the configured live-process threshold', async () => {
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      JSHOOK_INSTANCE_WARN_AT: 1,
      JSHOOK_MAX_INSTANCES: 0,
    }));
    const { registerServerInstance, unregisterServerInstance } =
      await import('@utils/InstanceRegistry');

    const result = await registerServerInstance();
    expect(result.warned).toBe(true);
    await unregisterServerInstance();
  });

  it('blocks before registration when the hard instance cap would be exceeded', async () => {
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      JSHOOK_INSTANCE_WARN_AT: 99,
      JSHOOK_MAX_INSTANCES: 1,
    }));
    const { getStateDir } = await import('@server/persistence/RuntimeSnapshotScheduler');
    const dir = join(getStateDir(), 'instances');
    await mkdir(dir, { recursive: true });
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

    const { registerServerInstance } = await import('@utils/InstanceRegistry');
    await expect(registerServerInstance()).rejects.toThrow(/instance limit reached/);
  });
});
