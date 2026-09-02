import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { dotenvMock } = vi.hoisted(() => ({
  dotenvMock: {
    config: vi.fn(),
  },
}));

vi.mock('dotenv', () => dotenvMock);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('runtime env bootstrap', () => {
  const originalEnv = { ...process.env };
  let tempRoot: string;
  let packageRoot: string;
  let nestedPackageRoot: string;

  beforeAll(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'jshook-env-bootstrap-'));
    packageRoot = join(tempRoot, 'runtime-package');
    nestedPackageRoot = join(packageRoot, 'packages', 'unrelated');
    await mkdir(join(nestedPackageRoot, 'dist'), { recursive: true });
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@jshookmcp/jshook' }),
      'utf8',
    );
    await writeFile(
      join(nestedPackageRoot, 'package.json'),
      JSON.stringify({ name: '@unrelated/package' }),
      'utf8',
    );
  });

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    dotenvMock.config.mockReset();
    dotenvMock.config.mockReturnValue({
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('finds the named package root from source and flattened dist module URLs', async () => {
    const { findRuntimeProjectRoot } = await import('@src/config/env-bootstrap');
    const expectedRoot = normalize(repositoryRoot);

    expect(
      findRuntimeProjectRoot(pathToFileURL(join(expectedRoot, 'src', 'config', 'module.ts')).href),
    ).toBe(expectedRoot);
    expect(
      findRuntimeProjectRoot(pathToFileURL(join(expectedRoot, 'dist', 'config-HASH.mjs')).href),
    ).toBe(expectedRoot);
  });

  it('skips a closer package.json whose package name does not match', async () => {
    const { findRuntimeProjectRoot } = await import('@src/config/env-bootstrap');
    const moduleUrl = pathToFileURL(join(nestedPackageRoot, 'dist', 'chunk.mjs')).href;

    expect(findRuntimeProjectRoot(moduleUrl)).toBe(normalize(packageRoot));
  });

  it('prefers package-root .env and falls back to cwd .env', async () => {
    const { resolveRuntimeEnvPath } = await import('@src/config/env-bootstrap');
    const cwd = join(tempRoot, 'caller');
    const packageEnv = join(packageRoot, '.env');
    const cwdEnv = join(cwd, '.env');
    await mkdir(cwd, { recursive: true });
    await writeFile(packageEnv, 'SOURCE=package\n', 'utf8');
    await writeFile(cwdEnv, 'SOURCE=cwd\n', 'utf8');

    expect(resolveRuntimeEnvPath(packageRoot, cwd)).toBe(normalize(packageEnv));

    await unlink(packageEnv);
    expect(resolveRuntimeEnvPath(packageRoot, cwd)).toBe(normalize(cwdEnv));
  });

  it('loads at module evaluation once and preserves parent-process precedence', async () => {
    dotenvMock.config.mockImplementation(() => {
      process.env.BOOTSTRAP_ORDER_SENTINEL ??= 'from-dotenv';
      return { parsed: { BOOTSTRAP_ORDER_SENTINEL: 'from-dotenv' } };
    });
    process.env.BOOTSTRAP_ORDER_SENTINEL = 'from-parent';

    const bootstrap = await import('@src/config/env-bootstrap');
    const second = bootstrap.bootstrapRuntimeEnv();

    expect(process.env.BOOTSTRAP_ORDER_SENTINEL).toBe('from-parent');
    expect(dotenvMock.config).toHaveBeenCalledTimes(1);
    expect(dotenvMock.config).toHaveBeenCalledWith(
      expect.objectContaining({ quiet: true, override: false }),
    );
    expect(second.projectRoot).toBe(bootstrap.runtimeProjectRoot);
  });

  it('loads dotenv before import-time constants snapshot the environment', async () => {
    delete process.env.MCP_TRANSPORT;
    dotenvMock.config.mockImplementation(() => {
      process.env.MCP_TRANSPORT = 'http';
      return { parsed: { MCP_TRANSPORT: 'http' } };
    });

    const { MCP_TRANSPORT } = await import('@src/constants/server');

    expect(MCP_TRANSPORT).toBe('http');
    expect(dotenvMock.config).toHaveBeenCalledTimes(1);
  });

  it('loads a real .env before an import-time constant snapshot without overriding parent env', async () => {
    const integrationTempRoot = join(repositoryRoot, '.temp');
    await mkdir(integrationTempRoot, { recursive: true });
    const integrationRoot = await mkdtemp(join(integrationTempRoot, 'env-bootstrap-real-'));
    const configDir = join(integrationRoot, 'src', 'config');

    try {
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(integrationRoot, 'package.json'),
        JSON.stringify({ name: '@jshookmcp/jshook', type: 'module' }),
        'utf8',
      );
      await writeFile(
        join(integrationRoot, '.env'),
        'REAL_BOOTSTRAP_INT=37\nREAL_BOOTSTRAP_PARENT=from-file\n',
        'utf8',
      );
      await copyFile(
        join(repositoryRoot, 'src', 'config', 'env-bootstrap.ts'),
        join(configDir, 'env-bootstrap.ts'),
      );
      await copyFile(
        join(repositoryRoot, 'src', 'config', 'environment.ts'),
        join(configDir, 'environment.ts'),
      );
      await writeFile(
        join(integrationRoot, 'src', 'runtime-constant.ts'),
        [
          "import { int } from './config/environment.js';",
          "export const RUNTIME_CONSTANT = int('REAL_BOOTSTRAP_INT', 0);",
          '',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        join(integrationRoot, 'src', 'probe.ts'),
        [
          "import { RUNTIME_CONSTANT } from './runtime-constant.js';",
          "import { bootstrapRuntimeEnv } from './config/env-bootstrap.js';",
          'const result = bootstrapRuntimeEnv();',
          'process.stdout.write(JSON.stringify({',
          '  constant: RUNTIME_CONSTANT,',
          '  parent: process.env.REAL_BOOTSTRAP_PARENT,',
          '  projectRoot: result.projectRoot,',
          '  envPath: result.envPath,',
          '  loaded: result.loaded,',
          '}));',
          '',
        ].join('\n'),
        'utf8',
      );

      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DEBUG: 'false',
        REAL_BOOTSTRAP_PARENT: 'from-parent',
      };
      delete childEnv.REAL_BOOTSTRAP_INT;
      const stdout = execFileSync(
        process.execPath,
        ['--import', 'tsx', join(integrationRoot, 'src', 'probe.ts')],
        {
          cwd: integrationRoot,
          encoding: 'utf8',
          env: childEnv,
        },
      );
      const observed = JSON.parse(stdout) as {
        constant: number;
        parent: string;
        projectRoot: string;
        envPath: string;
        loaded: boolean;
      };

      expect(observed).toEqual({
        constant: 37,
        parent: 'from-parent',
        projectRoot: normalize(integrationRoot),
        envPath: normalize(join(integrationRoot, '.env')),
        loaded: true,
      });
    } finally {
      await rm(integrationRoot, { recursive: true, force: true });
    }
  });
});
