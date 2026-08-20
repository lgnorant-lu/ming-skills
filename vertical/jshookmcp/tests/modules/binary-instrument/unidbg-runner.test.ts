import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnidbgRunner } from '@modules/binary-instrument/UnidbgRunner';

describe('UnidbgRunner', () => {
  const originalUnidbgJar = process.env['UNIDBG_JAR'];

  beforeEach(() => {
    delete process.env['UNIDBG_JAR'];
  });

  afterEach(() => {
    if (originalUnidbgJar === undefined) {
      delete process.env['UNIDBG_JAR'];
    } else {
      process.env['UNIDBG_JAR'] = originalUnidbgJar;
    }
  });

  describe('close', () => {
    it('does not throw when closing an unlaunched runner', () => {
      const r = new UnidbgRunner();
      expect(() => r.close()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      const r = new UnidbgRunner();
      r.close();
      expect(() => r.close()).not.toThrow();
    });
  });

  describe('launch', () => {
    it('does not register a stub session when the unidbg subprocess fails', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'unidbg-runner-'));
      const soPath = join(dir, 'libtarget.so');
      const jarPath = join(dir, 'not-a-real-unidbg.jar');
      await writeFile(soPath, new Uint8Array([0x7f, 0x45, 0x4c, 0x46]));
      await writeFile(jarPath, 'not a jar', 'utf8');

      const runner = new UnidbgRunner();
      await expect(runner.launch(soPath, 'arm64', jarPath)).rejects.toThrow();
      expect(runner.listSessions()).toEqual([]);
      runner.close();
      await rm(dir, { recursive: true, force: true });
    });
  });

  describe('callFunction', () => {
    it('throws when no session exists', async () => {
      const runner = new UnidbgRunner();
      await expect(runner.callFunction('nonexistent', 'testFunc', {})).rejects.toThrow();
      runner.close();
    });

    it('throws instead of returning a mock result when UNIDBG_JAR is missing', async () => {
      const runner = new UnidbgRunner();
      seedSession(runner, 'session-1');
      await expect(runner.callFunction('session-1', 'testFunc', {})).rejects.toThrow(/UNIDBG_JAR/i);
      runner.close();
    });
  });

  describe('trace', () => {
    it('throws when no session exists', async () => {
      const runner = new UnidbgRunner();
      await expect(runner.trace('nonexistent')).rejects.toThrow();
      runner.close();
    });

    it('throws instead of returning a mock trace when UNIDBG_JAR is missing', async () => {
      const runner = new UnidbgRunner();
      seedSession(runner, 'session-1');
      await expect(runner.trace('session-1')).rejects.toThrow(/UNIDBG_JAR/i);
      runner.close();
    });
  });
});

function seedSession(runner: UnidbgRunner, id: string): void {
  (
    runner as unknown as {
      sessions: Map<string, { id: string; soPath: string; arch: string; startedAt: string }>;
    }
  ).sessions.set(id, {
    id,
    soPath: '/tmp/libtarget.so',
    arch: 'arm64',
    startedAt: new Date(0).toISOString(),
  });
}
