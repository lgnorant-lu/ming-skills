import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPackageVersion } from '@utils/packageVersion';

describe('getPackageVersion', () => {
  let fixtureRoot: string;
  const originalEnvVersion = process.env.npm_package_version;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'pkg-version-'));

    // Nearest package.json (1 level up from the module file).
    await mkdir(join(fixtureRoot, 'pkg-a', 'src'), { recursive: true });
    await writeFile(
      join(fixtureRoot, 'pkg-a', 'package.json'),
      JSON.stringify({ name: 'pkg-a', version: '1.2.3' }),
    );

    // Deeply nested layout: package.json sits 8 levels above the module file —
    // beyond the historical 5-level walk limit.
    const deepDir = join(fixtureRoot, 'deep', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'src');
    await mkdir(deepDir, { recursive: true });
    await writeFile(
      join(fixtureRoot, 'deep', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'package.json'),
      JSON.stringify({ name: 'deep-pkg', version: '9.9.9' }),
    );

    // Invalid package.json version must be skipped (falls through to env).
    await mkdir(join(fixtureRoot, 'pkg-invalid', 'src'), { recursive: true });
    await writeFile(
      join(fixtureRoot, 'pkg-invalid', 'package.json'),
      JSON.stringify({ name: 'pkg-invalid', version: 'not-a-version' }),
    );

    // Versionless package.json must also be skipped.
    await mkdir(join(fixtureRoot, 'pkg-versionless', 'src'), { recursive: true });
    await writeFile(
      join(fixtureRoot, 'pkg-versionless', 'package.json'),
      JSON.stringify({ name: 'pkg-versionless' }),
    );

    // No package.json anywhere above this dir.
    await mkdir(join(fixtureRoot, 'naked', 'src'), { recursive: true });
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    if (originalEnvVersion === undefined) {
      delete process.env.npm_package_version;
    } else {
      process.env.npm_package_version = originalEnvVersion;
    }
  });

  const moduleUrlIn = (dir: string): string => pathToFileURL(join(dir, 'index.ts')).href;

  it('finds the nearest package.json version', () => {
    expect(getPackageVersion(moduleUrlIn(join(fixtureRoot, 'pkg-a', 'src')))).toBe('1.2.3');
  });

  it('walks beyond 5 levels to find a deeply nested package.json', () => {
    delete process.env.npm_package_version;
    expect(
      getPackageVersion(
        moduleUrlIn(join(fixtureRoot, 'deep', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'src')),
      ),
    ).toBe('9.9.9');
  });

  it('skips package.json files with invalid versions and keeps walking', () => {
    delete process.env.npm_package_version;
    expect(getPackageVersion(moduleUrlIn(join(fixtureRoot, 'pkg-invalid', 'src')))).toBe('0.0.0');
  });

  it('skips versionless package.json files', () => {
    delete process.env.npm_package_version;
    expect(getPackageVersion(moduleUrlIn(join(fixtureRoot, 'pkg-versionless', 'src')))).toBe(
      '0.0.0',
    );
  });

  it('trusts npm_package_version only when it is a valid semver string', () => {
    process.env.npm_package_version = '4.5.6-beta.1';
    expect(getPackageVersion(moduleUrlIn(join(fixtureRoot, 'naked', 'src')))).toBe('4.5.6-beta.1');
  });

  it('rejects invalid npm_package_version values and falls back to 0.0.0', () => {
    process.env.npm_package_version = 'banana';
    expect(getPackageVersion(moduleUrlIn(join(fixtureRoot, 'naked', 'src')))).toBe('0.0.0');

    process.env.npm_package_version = 'v1.2.3'; // v-prefix is not a bare semver
    expect(getPackageVersion(moduleUrlIn(join(fixtureRoot, 'naked', 'src')))).toBe('0.0.0');

    process.env.npm_package_version = '1.2'; // missing patch
    expect(getPackageVersion(moduleUrlIn(join(fixtureRoot, 'naked', 'src')))).toBe('0.0.0');
  });

  it('falls back to 0.0.0 when nothing is found and env is unset', () => {
    delete process.env.npm_package_version;
    expect(getPackageVersion(moduleUrlIn(join(fixtureRoot, 'naked', 'src')))).toBe('0.0.0');
  });
});
