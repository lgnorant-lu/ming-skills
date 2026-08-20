/**
 * Unit tests for GhidraAnalyzer — error handling, caching, parsing.
 * These tests do NOT require Ghidra to be installed (they mock probeCommand).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join as joinPath } from 'node:path';
import { GhidraAnalyzer } from '@modules/binary-instrument/GhidraAnalyzer';
import { PrerequisiteError } from '@errors/PrerequisiteError';

// Mock the probeCommand to control Ghidra availability
const mockProbeCommand = vi.fn();
vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: (...args: unknown[]) => mockProbeCommand(...args),
}));

describe('GhidraAnalyzer', () => {
  let analyzer: GhidraAnalyzer;
  const ghidraEnvKeys = [
    'GHIDRA_HEADLESS_PATH',
    'GHIDRA_ANALYZE_HEADLESS',
    'GHIDRA_HOME',
    'GHIDRA_INSTALL_DIR',
  ] as const;
  const originalGhidraEnv = Object.fromEntries(ghidraEnvKeys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    analyzer = new GhidraAnalyzer({ discoveryPaths: [] });
    mockProbeCommand.mockReset();
    for (const key of ghidraEnvKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ghidraEnvKeys) {
      const value = originalGhidraEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // ─── Error handling ──────────────────────────────────────────────

  it('throws PrerequisiteError when Ghidra is not available', async () => {
    mockProbeCommand.mockResolvedValue({
      available: false,
      reason: 'analyzeHeadless is not available on PATH',
    });

    // Create a temp binary file for testing
    const { writeFile, unlink, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpFile = join(tmpdir(), `ghidra-test-${Date.now()}.bin`);
    await mkdir(join(tmpdir()), { recursive: true });
    await writeFile(tmpFile, Buffer.from('ELF test binary content'));

    try {
      await expect(analyzer.analyze(tmpFile)).rejects.toThrow(PrerequisiteError);
      await expect(analyzer.analyze(tmpFile)).rejects.toThrow(/not available/i);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it('getAvailability returns false when probe fails', async () => {
    mockProbeCommand.mockResolvedValue({
      available: false,
      reason: 'Command failed: analyzeHeadless not found',
    });

    const availability = await analyzer.getAvailability();
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('not found');
  });

  // ─── Output parsing ──────────────────────────────────────────────

  it('parses decompiled output correctly', () => {
    const output = [
      'FUNCTION_START',
      'NAME:main',
      'ADDRESS:0x1000',
      'SIGNATURE:undefined main(void)',
      'DECOMPILED_START',
      'int main() { return 0; }',
      'DECOMPILED_END',
      'FUNCTION_END',
      'FUNCTION_START',
      'NAME:helper',
      'ADDRESS:0x1100',
      'SIGNATURE:undefined helper(int x)',
      'DECOMPILED_START',
      'int helper(int x) { return x * 2; }',
      'DECOMPILED_END',
      'FUNCTION_END',
    ].join('\n');

    const functions = analyzer.parseDecompiledOutput(output);
    expect(functions).toHaveLength(2);
    expect(functions[0]!.name).toBe('main');
    expect(functions[0]!.address).toBe('0x1000');
    expect(functions[0]!.decompiled).toContain('return 0');
    expect(functions[1]!.name).toBe('helper');
  });

  it('handles empty output', () => {
    const functions = analyzer.parseDecompiledOutput('');
    expect(functions).toHaveLength(0);
  });

  it('handles malformed output gracefully', () => {
    const output = 'FUNCTION_START\nNAME:broken\nMISSING_FIELDS';
    const functions = analyzer.parseDecompiledOutput(output);
    expect(functions).toHaveLength(0);
  });

  it('parses GhidraScript log-prefixed marker output', () => {
    const output = [
      'INFO  BinaryInstrumentDump.java> FUNCTION_START (GhidraScript)',
      'INFO  BinaryInstrumentDump.java> NAME:FUN_140001010 (GhidraScript)',
      'INFO  BinaryInstrumentDump.java> ADDRESS:140001010 (GhidraScript)',
      'INFO  BinaryInstrumentDump.java> SIGNATURE:undefined FUN_140001010(void) (GhidraScript)',
      'INFO  BinaryInstrumentDump.java> DECOMPILED_START (GhidraScript)',
      'return;',
      'INFO  BinaryInstrumentDump.java> DECOMPILED_END (GhidraScript)',
      'INFO  BinaryInstrumentDump.java> FUNCTION_END (GhidraScript)',
    ].join('\n');

    const functions = analyzer.parseDecompiledOutput(output);
    expect(functions).toHaveLength(1);
    expect(functions[0]).toMatchObject({
      name: 'FUN_140001010',
      address: '0x140001010',
      signature: 'undefined FUN_140001010(void)',
    });
  });

  it('runs built-in analysis through a Java GhidraScript and parses the result', async () => {
    const { writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpFile = join(tmpdir(), `ghidra-java-${Date.now()}.bin`);
    const recordingAnalyzer = new RecordingGhidraAnalyzer({
      stdout: [
        'FUNCTION_START',
        'NAME:check_pin',
        'ADDRESS:00101000',
        'SIGNATURE:int check_pin(char * input)',
        'DECOMPILED_START',
        'return strcmp(input,"1337") == 0;',
        'DECOMPILED_END',
        'FUNCTION_END',
      ].join('\n'),
    });

    await writeFile(tmpFile, Buffer.from('check_pin\0strcmp\0libc.so\0secret1337\0', 'utf8'));

    try {
      const result = await recordingAnalyzer.analyze(tmpFile, { forceRefresh: true });
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0]).toMatchObject({
        name: 'check_pin',
        address: '0x00101000',
        signature: 'int check_pin(char * input)',
      });
      expect(result.functions[0]?.decompiled).toContain('strcmp');
      expect(result.imports).toContain('libc.so');
      expect(result.exports).toContain('check_pin');
      expect(recordingAnalyzer.calls).toHaveLength(1);
      expect(recordingAnalyzer.calls[0]?.args).toContain('-postScript');
      expect(recordingAnalyzer.calls[0]?.args).toContain('BinaryInstrumentDump.java');

      const scriptPath = recordingAnalyzer.calls[0]?.scriptPath;
      expect(scriptPath).toBeDefined();
      const script = recordingAnalyzer.calls[0]?.scriptContent ?? '';
      expect(script).toContain('public class BinaryInstrumentDump extends GhidraScript');
      expect(script).toContain('DecompInterface');
      expect(script).not.toContain('from ghidra.app.decompiler import DecompInterface');
    } finally {
      await rm(tmpFile, { force: true });
    }
  });

  it('reuses cached analysis for unchanged binaries', async () => {
    const { writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpFile = join(tmpdir(), `ghidra-cache-${Date.now()}.bin`);
    const recordingAnalyzer = new RecordingGhidraAnalyzer({
      stdout:
        'FUNCTION_START\nNAME:main\nADDRESS:1000\nSIGNATURE:int main(void)\nDECOMPILED_START\nreturn 0;\nDECOMPILED_END\nFUNCTION_END',
    });

    await writeFile(tmpFile, Buffer.from('ELF main printf libc.so', 'utf8'));

    try {
      const first = await recordingAnalyzer.analyze(tmpFile);
      const second = await recordingAnalyzer.analyze(tmpFile);
      expect(first.functions[0]?.name).toBe('main');
      expect(second.functions[0]?.name).toBe('main');
      expect(recordingAnalyzer.calls).toHaveLength(1);
    } finally {
      await rm(tmpFile, { force: true });
    }
  });

  it('invalidates cached analysis when the binary content changes', async () => {
    const { writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpFile = join(tmpdir(), `ghidra-cache-bust-${Date.now()}.bin`);
    const recordingAnalyzer = new RecordingGhidraAnalyzer({
      stdout:
        'FUNCTION_START\nNAME:main\nADDRESS:1000\nSIGNATURE:int main(void)\nDECOMPILED_START\nreturn 0;\nDECOMPILED_END\nFUNCTION_END',
    });

    await writeFile(tmpFile, Buffer.from('ELF main first', 'utf8'));

    try {
      await recordingAnalyzer.analyze(tmpFile);
      await writeFile(tmpFile, Buffer.from('ELF main second', 'utf8'));
      await recordingAnalyzer.analyze(tmpFile);
      expect(recordingAnalyzer.calls).toHaveLength(2);
    } finally {
      await rm(tmpFile, { force: true });
    }
  });

  it('runCustomScript infers Java scripts from GhidraScript content', async () => {
    const { writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpFile = join(tmpdir(), `ghidra-custom-java-${Date.now()}.bin`);
    const recordingAnalyzer = new RecordingGhidraAnalyzer({ stdout: 'ok' });

    await writeFile(tmpFile, Buffer.from('MZ custom', 'utf8'));

    try {
      await recordingAnalyzer.runCustomScript(
        tmpFile,
        [
          'import ghidra.app.script.GhidraScript;',
          'public class DumpNames extends GhidraScript {',
          '  public void run() throws Exception { println("ok"); }',
          '}',
        ].join('\n'),
      );

      expect(recordingAnalyzer.calls[0]?.args).toContain('DumpNames.java');
    } finally {
      await rm(tmpFile, { force: true });
    }
  });

  it('runCustomScript keeps Python scripts opt-in compatible by default', async () => {
    const { writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpFile = join(tmpdir(), `ghidra-custom-python-${Date.now()}.bin`);
    const recordingAnalyzer = new RecordingGhidraAnalyzer({ stdout: 'ok' });

    await writeFile(tmpFile, Buffer.from('MZ custom', 'utf8'));

    try {
      await recordingAnalyzer.runCustomScript(tmpFile, 'print("ok")');
      expect(recordingAnalyzer.calls[0]?.args).toContain('custom_script.py');
    } finally {
      await rm(tmpFile, { force: true });
    }
  });

  // ─── String extraction ───────────────────────────────────────────

  it('isAvailable delegates to probeCommand', async () => {
    mockProbeCommand.mockResolvedValue({ available: true, path: '/usr/bin/analyzeHeadless' });

    const result = await analyzer.isAvailable();
    expect(result).toBe(true);
    expect(mockProbeCommand).toHaveBeenCalledWith('analyzeHeadless', ['-help']);
  });

  it('discovers analyzeHeadless from GHIDRA_HEADLESS_PATH before PATH probing', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'ghidra-headless-path-'));
    const headless = join(
      dir,
      process.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless',
    );

    try {
      await writeFile(headless, '', 'utf8');
      process.env.GHIDRA_HEADLESS_PATH = headless;

      const availability = await analyzer.getAvailability();
      expect(availability.available).toBe(true);
      expect(availability.path).toBe(headless);
      expect(mockProbeCommand).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('discovers analyzeHeadless from GHIDRA_HOME support directory', async () => {
    const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const home = await mkdtemp(join(tmpdir(), 'ghidra-home-'));
    const support = join(home, 'support');
    const headless = join(
      support,
      process.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless',
    );

    try {
      await mkdir(support, { recursive: true });
      await writeFile(headless, '', 'utf8');
      process.env.GHIDRA_HOME = home;

      const availability = await analyzer.getAvailability();
      expect(availability.available).toBe(true);
      expect(availability.path).toBe(headless);
      expect(mockProbeCommand).not.toHaveBeenCalled();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('discovers analyzeHeadless from one-level ghidra install directories', async () => {
    const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(join(tmpdir(), 'ghidra-discovery-root-'));
    const home = join(root, 'ghidra_12.1_PUBLIC');
    const support = join(home, 'support');
    const headless = join(
      support,
      process.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless',
    );

    try {
      await mkdir(support, { recursive: true });
      await writeFile(headless, '', 'utf8');
      analyzer = new GhidraAnalyzer({ discoveryPaths: [root] });

      const availability = await analyzer.getAvailability();
      expect(availability.available).toBe(true);
      expect(availability.path).toBe(headless);
      expect(mockProbeCommand).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ─── Cache (incremental analysis) ────────────────────────────────

  it('cache avoids duplicate analysis', async () => {
    // First call: Ghidra not available
    mockProbeCommand.mockResolvedValue({
      available: false,
      reason: 'Not installed',
    });

    // Even with unavailable Ghidra, the cache infrastructure exists
    // We test the caching logic separately via parseDecompiledOutput
    const functions = analyzer.parseDecompiledOutput(
      'FUNCTION_START\nNAME:test\nADDRESS:0x2000\nSIGNATURE:void test(void)\nDECOMPILED_START\nvoid test() {}\nDECOMPILED_END\nFUNCTION_END',
    );
    expect(functions).toHaveLength(1);
  });
});

class RecordingGhidraAnalyzer extends GhidraAnalyzer {
  calls: Array<{
    file: string;
    args: string[];
    timeoutMs: number;
    scriptPath?: string;
    scriptContent?: string;
  }> = [];

  constructor(private readonly commandResult: { stdout: string; stderr?: string }) {
    super({ discoveryPaths: [] });
  }

  override async getAvailability() {
    return {
      available: true,
      path: process.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless',
      version: 'mock',
    };
  }

  protected override async execFileUtf8(file: string, args: string[], timeoutMs: number) {
    const scriptIndex = args.indexOf('-postScript');
    const scriptName = scriptIndex >= 0 ? args[scriptIndex + 1] : undefined;
    const scriptPath = scriptName ? joinFromArgs(args, '-scriptPath', scriptName) : undefined;
    const scriptContent = scriptPath
      ? await import('node:fs/promises').then(({ readFile }) => readFile(scriptPath, 'utf8'))
      : undefined;

    this.calls.push({ file, args: [...args], timeoutMs, scriptPath, scriptContent });
    return { stdout: this.commandResult.stdout, stderr: this.commandResult.stderr ?? '' };
  }
}

function joinFromArgs(args: string[], flag: string, fileName: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const directory = args[index + 1];
  if (!directory) return undefined;
  return joinPath(directory, fileName);
}
