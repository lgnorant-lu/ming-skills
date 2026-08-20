import { promises as fs, existsSync } from 'fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

let scriptsBaseDir: string | null = null;

function tryGetEsmBaseDir(): string | null {
  if (scriptsBaseDir) {
    return scriptsBaseDir;
  }

  try {
    scriptsBaseDir = fileURLToPath(new URL('.', import.meta.url));
    return scriptsBaseDir;
  } catch {
    return null;
  }
}

export class ScriptLoader {
  private scriptCache = new Map<string, string>();
  private scriptsDir: string;

  constructor() {
    const esmDir = tryGetEsmBaseDir();
    // In tsdown flat mode, esmDir is 'dist' so we check native/scripts.
    // In src or test mode, it's deep inside src/native, where scripts are alongside it.
    if (esmDir && existsSync(join(esmDir, 'native', 'scripts'))) {
      this.scriptsDir = join(esmDir, 'native', 'scripts');
    } else if (esmDir && existsSync(join(esmDir, 'scripts'))) {
      this.scriptsDir = join(esmDir, 'scripts');
    } else if (existsSync(join(process.cwd(), 'dist', 'native', 'scripts'))) {
      this.scriptsDir = join(process.cwd(), 'dist', 'native', 'scripts');
    } else if (existsSync(join(process.cwd(), 'src', 'native', 'scripts'))) {
      this.scriptsDir = join(process.cwd(), 'src', 'native', 'scripts');
    } else {
      this.scriptsDir = join(process.cwd(), 'dist', 'native', 'scripts');
    }
  }

  async loadScript(name: string): Promise<string> {
    if (this.scriptCache.has(name)) {
      return this.scriptCache.get(name)!;
    }

    const plat = platform();
    const platformDir = plat === 'win32' ? 'windows' : plat === 'darwin' ? 'macos' : 'linux';
    const scriptPath = join(this.scriptsDir, platformDir, name);

    const content = await fs.readFile(scriptPath, 'utf-8');
    this.scriptCache.set(name, content);
    return content;
  }

  /**
   * Get the file system path to a script (for -File execution)
   */
  getScriptPath(name: string): string {
    const plat = platform();
    const platformDir = plat === 'win32' ? 'windows' : plat === 'darwin' ? 'macos' : 'linux';
    return join(this.scriptsDir, platformDir, name);
  }

  clearCache(): void {
    this.scriptCache.clear();
  }
}
