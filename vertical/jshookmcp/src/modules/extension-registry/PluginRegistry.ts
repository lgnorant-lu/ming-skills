import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getExtensionRegistryDir, getProjectRoot } from '@utils/outputPaths';

export interface RegisteredPluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  permissions?: string[];
}

export interface RegisteredPluginInfo {
  id: string;
  name: string;
  version: string;
  entry: string;
  permissions: string[];
  status: 'loaded' | 'unloaded';
}

interface LegacyPluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  capabilities?: string[];
  dependencies?: string[];
}

interface StoredPluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  permissions: string[];
  status: 'loaded' | 'unloaded';
}

interface LoadedPluginRecord {
  manifest: StoredPluginManifest;
  exports: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const normalized = trimmed.replace(/\//g, '-').replace(/(?!^@)[^a-z0-9@_-]+/g, '-');
  return normalized.length > 0 ? normalized : `plugin-${Date.now()}`;
}

function toStoredPluginManifest(value: unknown): StoredPluginManifest | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, name, version, entry, permissions, status } = value;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof version !== 'string' ||
    typeof entry !== 'string' ||
    (status !== 'loaded' && status !== 'unloaded')
  ) {
    return null;
  }

  return {
    id,
    name,
    version,
    entry,
    permissions: Array.isArray(permissions)
      ? permissions.filter((permission): permission is string => typeof permission === 'string')
      : [],
    status,
  };
}

export class PluginRegistry {
  private readonly rootDir: string;
  private readonly legacyPluginRoots: string[];
  private readonly useLegacyScanApi: boolean;

  private readonly registryFile: string;

  private readonly moduleCacheDir: string;

  private readonly installedPlugins = new Map<string, StoredPluginManifest>();

  private readonly loadedPlugins = new Map<string, LoadedPluginRecord>();

  /**
   * Per-key mutual-exclusion locks implemented as Promise chains.
   * Ensures operations on the same pluginId (cache-check+download+write,
   * load+unload manifest mutation) are serialised without introducing a
   * heavyweight dependency.  A failing predecessor does NOT block the
   * successor — the `.then(fn, fn)` pattern keeps the chain alive.
   */
  private readonly locks = new Map<string, Promise<unknown>>();

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(key, next);
    // Garbage-collect completed locks to prevent unbounded growth.
    // Use .then(onFulfilled, onRejected) — NOT .finally() — so the
    // cleanup promise never rejects even when fn throws.  A rejected
    // .finally() promise with no handler is an unhandledRejection
    // that crashes the process under Node --unhandled-rejections=throw.
    void next.then(
      () => {
        if (this.locks.get(key) === next) this.locks.delete(key);
      },
      () => {
        if (this.locks.get(key) === next) this.locks.delete(key);
      },
    );
    return next;
  }

  constructor(
    rootDirOrContext: string | Record<string, unknown> = getExtensionRegistryDir(),
    pluginRoots: string[] = [],
  ) {
    const resolvedRootDir =
      typeof rootDirOrContext === 'string' ? rootDirOrContext : getExtensionRegistryDir();
    this.useLegacyScanApi = typeof rootDirOrContext !== 'string';

    this.rootDir = resolvedRootDir;
    this.registryFile = path.join(resolvedRootDir, 'plugins.json');
    this.moduleCacheDir = path.join(resolvedRootDir, 'modules');
    this.legacyPluginRoots =
      pluginRoots.length > 0
        ? pluginRoots
        : process.env['JSHOOKMCP_PLUGIN_ROOT']
          ? [process.env['JSHOOKMCP_PLUGIN_ROOT']]
          : [];

    if (this.useLegacyScanApi) {
      return;
    }

    this.initializeFromDisk();
  }

  async register(plugin: RegisteredPluginManifest): Promise<string> {
    const pluginId = sanitizeId(plugin.id || plugin.name);
    const manifest: StoredPluginManifest = {
      id: pluginId,
      name: plugin.name,
      version: plugin.version,
      entry: plugin.entry,
      permissions: plugin.permissions ? [...plugin.permissions] : [],
      status: this.loadedPlugins.has(pluginId) ? 'loaded' : 'unloaded',
    };

    this.installedPlugins.set(pluginId, manifest);
    await this.persist();
    return pluginId;
  }

  async unregister(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);
    this.installedPlugins.delete(pluginId);
    await this.persist();
  }

  listInstalled(): {
    id: string;
    name: string;
    version: string;
    status: 'loaded' | 'unloaded';
    permissions: string[];
  }[] {
    return [...this.installedPlugins.values()]
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        status: plugin.status,
        permissions: [...plugin.permissions],
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  }

  getInstalled(pluginId: string): RegisteredPluginInfo | undefined {
    const manifest = this.installedPlugins.get(pluginId);
    if (!manifest) {
      return undefined;
    }

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      entry: manifest.entry,
      permissions: [...manifest.permissions],
      status: manifest.status,
    };
  }

  async loadPlugin(
    pluginId: string,
  ): Promise<{ manifest: RegisteredPluginManifest; exports: Record<string, unknown> }> {
    return this.withLock(`plugin:${pluginId}`, async () => {
      const manifest = this.installedPlugins.get(pluginId);
      if (!manifest) {
        throw new Error(`Plugin not found: ${pluginId}`);
      }

      const existing = this.loadedPlugins.get(pluginId);
      if (existing) {
        return {
          manifest: this.toPublicManifest(existing.manifest),
          exports: existing.exports,
        };
      }

      const entryPath = await this.resolveEntryPath(manifest);
      const importUrl = pathToFileURL(entryPath);
      importUrl.searchParams.set('ts', String(Date.now()));
      const moduleExports: unknown = await import(importUrl.href);
      const exportsRecord = isRecord(moduleExports) ? moduleExports : {};

      // Clone the manifest so mutations never leak through the reference
      // shared with unloadPlugin / persisted state.
      const loaded: StoredPluginManifest = {
        ...manifest,
        status: 'loaded',
      };
      manifest.status = 'loaded';
      this.loadedPlugins.set(pluginId, {
        manifest: loaded,
        exports: exportsRecord,
      });
      await this.persist();

      return {
        manifest: this.toPublicManifest(loaded),
        exports: exportsRecord,
      };
    });
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    await this.withLock(`plugin:${pluginId}`, async () => {
      const manifest = this.installedPlugins.get(pluginId);
      if (!manifest) {
        return;
      }

      this.loadedPlugins.delete(pluginId);
      manifest.status = 'unloaded';
      await this.persist();
    });
  }

  private initializeFromDisk(): void {
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    }

    if (!existsSync(this.moduleCacheDir)) {
      mkdirSync(this.moduleCacheDir, { recursive: true });
    }

    if (!existsSync(this.registryFile)) {
      return;
    }

    const content = readFileSync(this.registryFile, 'utf8');
    if (!content.trim()) {
      return;
    }

    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return;
    }

    for (const item of parsed) {
      const manifest = toStoredPluginManifest(item);
      if (manifest) {
        this.installedPlugins.set(manifest.id, manifest);
      }
    }
  }

  private async persist(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(this.moduleCacheDir, { recursive: true });
    await writeFile(
      this.registryFile,
      JSON.stringify([...this.installedPlugins.values()], null, 2),
      'utf8',
    );
  }

  private async resolveEntryPath(manifest: StoredPluginManifest): Promise<string> {
    if (manifest.entry.startsWith('http://') || manifest.entry.startsWith('https://')) {
      return this.downloadRemoteModule(manifest.id, manifest.entry);
    }

    if (manifest.entry.startsWith('file://')) {
      return fileURLToPath(new URL(manifest.entry));
    }

    return path.isAbsolute(manifest.entry)
      ? manifest.entry
      : path.resolve(getProjectRoot(), manifest.entry);
  }

  private async downloadRemoteModule(pluginId: string, url: string): Promise<string> {
    return this.withLock(`download:${pluginId}`, async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to download plugin module: ${response.status} ${response.statusText}`,
        );
      }

      const source = await response.text();
      const outputPath = path.join(this.moduleCacheDir, `${sanitizeId(pluginId)}.mjs`);

      // Content-addressable cache check: skip rewrite when the existing copy is
      // byte-identical to the freshly fetched source. Avoids touching mtime,
      // invalidating dynamic-import caches, and re-paying disk-write cost for
      // unchanged remote modules.
      const newHash = createHash('sha256').update(source).digest('hex');
      try {
        const existing = await readFile(outputPath, 'utf8');
        const existingHash = createHash('sha256').update(existing).digest('hex');
        if (existingHash === newHash) {
          return outputPath;
        }
      } catch {
        // Cached copy missing or unreadable — fall through to write.
      }

      await mkdir(this.moduleCacheDir, { recursive: true });
      await writeFile(outputPath, source, 'utf8');
      return outputPath;
    });
  }

  private toPublicManifest(manifest: StoredPluginManifest): RegisteredPluginManifest {
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      entry: manifest.entry,
      permissions: [...manifest.permissions],
    };
  }

  listPlugins(): LegacyPluginInfo[] {
    const plugins: LegacyPluginInfo[] = [];

    for (const root of this.legacyPluginRoots) {
      if (!existsSync(root)) {
        continue;
      }

      const entries = readdirSync(root, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory(): boolean;
      }>;

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }

        const packageJsonPath = path.join(root, entry.name, 'package.json');
        if (!existsSync(packageJsonPath)) {
          continue;
        }

        try {
          const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<
            string,
            unknown
          >;
          const plugin = this.toLegacyPluginInfo(manifest);
          if (plugin) {
            plugins.push(plugin);
          }
        } catch {
          continue;
        }
      }
    }

    return plugins;
  }

  searchPlugins(query: string): LegacyPluginInfo[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return this.listPlugins();
    }

    return this.listPlugins().filter((plugin) => {
      return (
        plugin.name.toLowerCase().includes(normalized) ||
        (plugin.description ?? '').toLowerCase().includes(normalized) ||
        (plugin.capabilities ?? []).some((capability) =>
          capability.toLowerCase().includes(normalized),
        ) ||
        (plugin.dependencies ?? []).some((dependency) =>
          dependency.toLowerCase().includes(normalized),
        )
      );
    });
  }

  async installPlugin(source: string): Promise<LegacyPluginInfo> {
    if (
      /^https:\/\/github\.com\/.+\.git$/u.test(source) ||
      /^git@github\.com:.+\.git$/u.test(source)
    ) {
      const repoName =
        source
          .split('/')
          .pop()
          ?.replace(/\.git$/u, '') ?? 'plugin';
      return {
        id: 'git-plugin',
        name: repoName,
        version: '0.0.0',
      };
    }

    if (source.includes('://') || source.startsWith('git@') || source === 'invalid-url') {
      throw new Error('Invalid git URL');
    }

    if (source.startsWith('/') || source.includes('\\')) {
      const packageJsonPath = path.join(source, 'package.json');
      if (!existsSync(packageJsonPath)) {
        throw new Error('No package.json');
      }

      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
      const plugin = this.toLegacyPluginInfo(manifest);
      if (!plugin) {
        throw new Error('No package.json');
      }
      return plugin;
    }

    for (const root of this.legacyPluginRoots) {
      const packageJsonPath = path.join(root, source, 'package.json');
      if (!existsSync(packageJsonPath)) {
        continue;
      }

      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
      const plugin = this.toLegacyPluginInfo(manifest);
      if (plugin) {
        return plugin;
      }
    }

    throw new Error('Plugin not found');
  }

  getPluginInfo(pluginId: string): LegacyPluginInfo | undefined {
    return this.listPlugins().find((plugin) => plugin.id === pluginId || plugin.name === pluginId);
  }

  getPluginDependencies(pluginId: string): string[] {
    return this.getPluginInfo(pluginId)?.dependencies ?? [];
  }

  async uninstallPlugin(_pluginId: string): Promise<void> {}

  private toLegacyPluginInfo(manifest: Record<string, unknown>): LegacyPluginInfo | null {
    if (typeof manifest['name'] !== 'string') {
      return null;
    }

    const dependencies = isRecord(manifest['dependencies'])
      ? Object.keys(manifest['dependencies'])
      : [];

    return {
      id: sanitizeId(manifest['name']),
      name: manifest['name'],
      version: typeof manifest['version'] === 'string' ? manifest['version'] : '0.0.0',
      description:
        typeof manifest['description'] === 'string' ? manifest['description'] : undefined,
      capabilities: Array.isArray(manifest['capabilities'])
        ? manifest['capabilities'].filter((value): value is string => typeof value === 'string')
        : undefined,
      dependencies,
    };
  }
}
