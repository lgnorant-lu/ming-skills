import { open, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import { findDexArtifacts, type DexFileArtifact } from './dex-artifacts';

export interface AndroidRuntimeDumpStartOptions {
  packageName?: string;
  pid?: number;
  outputDir: string;
  mapsPath?: string;
  maxDexFiles?: number;
  maxDexFileBytes?: number;
  maxTotalDexBytes?: number;
  maxMapsBytes?: number;
  maxMapsModules?: number;
}

export interface AndroidRuntimeDumpStatusOptions {
  sessionId: string;
}

export interface AndroidRuntimeDumpSession {
  sessionId: string;
  createdAt: string;
  target: {
    packageName?: string;
    pid?: number;
  };
  outputDir: string;
  mapsPath?: string;
  evidence: AndroidRuntimeDumpEvidence;
  recommendedNextSteps: string[];
}

export interface AndroidRuntimeDumpEvidence {
  dumpedDex: {
    count: number;
    files: DexFileArtifact[];
  };
  maps: {
    moduleCount: number;
    modules: AndroidRuntimeMapModule[];
    truncated?: boolean;
    sourceSize?: number;
    bytesRead?: number;
  };
}

export interface AndroidRuntimeMapModule {
  start: string;
  end: string;
  perms: string;
  offset: string;
  path: string;
}

export class AndroidRuntimeDumpSessionManager {
  private readonly sessions = new Map<string, AndroidRuntimeDumpSession>();

  async start(options: AndroidRuntimeDumpStartOptions): Promise<AndroidRuntimeDumpSession> {
    const dumpedDex = await findDexArtifacts({
      rootDir: options.outputDir,
      limit: options.maxDexFiles,
      ...(options.maxDexFileBytes !== undefined ? { maxFileBytes: options.maxDexFileBytes } : {}),
      ...(options.maxTotalDexBytes !== undefined
        ? { maxTotalBytes: options.maxTotalDexBytes }
        : {}),
    });
    const maps = options.mapsPath
      ? await readMapsModules(options.mapsPath, {
          maxBytes: options.maxMapsBytes,
          moduleLimit: options.maxMapsModules,
        })
      : { modules: [] };
    const session: AndroidRuntimeDumpSession = {
      sessionId: randomUUID(),
      createdAt: new Date().toISOString(),
      target: {
        ...(options.packageName ? { packageName: options.packageName } : {}),
        ...(options.pid !== undefined ? { pid: options.pid } : {}),
      },
      outputDir: options.outputDir,
      ...(options.mapsPath ? { mapsPath: options.mapsPath } : {}),
      evidence: {
        dumpedDex: {
          count: dumpedDex.length,
          files: dumpedDex,
        },
        maps: {
          moduleCount: maps.modules.length,
          modules: maps.modules,
          ...(maps.truncated ? { truncated: true } : {}),
          ...(maps.sourceSize !== undefined ? { sourceSize: maps.sourceSize } : {}),
          ...(maps.bytesRead !== undefined ? { bytesRead: maps.bytesRead } : {}),
        },
      },
      recommendedNextSteps: buildNextSteps(dumpedDex.length, maps.modules),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  status(options: AndroidRuntimeDumpStatusOptions): AndroidRuntimeDumpSession | undefined {
    return this.sessions.get(options.sessionId);
  }

  list(): AndroidRuntimeDumpSession[] {
    return [...this.sessions.values()];
  }
}

async function readMapsModules(
  mapsPath: string,
  options: { maxBytes?: number; moduleLimit?: number } = {},
): Promise<{
  modules: AndroidRuntimeMapModule[];
  truncated?: boolean;
  sourceSize?: number;
  bytesRead?: number;
}> {
  const source = await stat(mapsPath).catch(() => undefined);
  if (!source?.isFile()) return { modules: [] };
  const config = getReverseEngineeringConfig().androidRuntime;
  const maxBytes = clampLimit(options.maxBytes, config.mapsMaxBytes);
  const moduleLimit = clampLimit(options.moduleLimit, config.mapsModuleLimit);
  const bytesToRead = Math.min(source.size, maxBytes);
  const bytes = await readFilePrefix(mapsPath, bytesToRead).catch(() => Buffer.alloc(0));
  const text = bytes.toString('utf8');
  const modules: AndroidRuntimeMapModule[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseMapsLine(line);
    if (!parsed || seen.has(parsed.path)) continue;
    seen.add(parsed.path);
    modules.push(parsed);
    if (modules.length >= moduleLimit) break;
  }
  const truncated = bytes.length < source.size || modules.length >= moduleLimit;
  return {
    modules,
    ...(truncated ? { truncated: true } : {}),
    sourceSize: source.size,
    bytesRead: bytes.length,
  };
}

async function readFilePrefix(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), fallback));
}

function parseMapsLine(line: string): AndroidRuntimeMapModule | null {
  const match = /^([0-9a-fA-F]+)-([0-9a-fA-F]+)\s+(\S+)\s+([0-9a-fA-F]+)\s+\S+\s+\S+\s*(.*)$/.exec(
    line.trim(),
  );
  if (!match) return null;
  const path = (match[5] ?? '').trim();
  if (!path || path.startsWith('[')) return null;
  return {
    start: `0x${match[1]}`,
    end: `0x${match[2]}`,
    perms: match[3] ?? '',
    offset: `0x${match[4] ?? '0'}`,
    path,
  };
}

function buildNextSteps(dexCount: number, modules: AndroidRuntimeMapModule[]): string[] {
  const nativeModules = modules.filter((module) => /\.so$/i.test(module.path));
  return [
    dexCount > 0
      ? 'Run dex_scan_file or jadx_decompile_apk against dumped DEX artifacts selected from this session.'
      : 'No DEX artifacts found in outputDir; rerun frida_dex_dump or collect /proc/PID/mem ranges from maps.',
    nativeModules.length > 0
      ? 'Map native modules back to APK libraries, then inspect suspicious .so files with ghidra/unidbg/native-emulator.'
      : 'No native .so modules found in maps snapshot.',
  ];
}
