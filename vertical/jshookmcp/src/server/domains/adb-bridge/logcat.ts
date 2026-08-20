import { spawn } from 'node:child_process';

export interface LogcatLineFilter {
  pid?: string;
  packageName?: string;
  pattern?: RegExp;
  predicate?: (line: string) => boolean;
  maxLines: number;
}

export interface AdbLogcatCaptureOptions extends LogcatLineFilter {
  adb: string;
  args: string[];
  timeoutMs: number;
  maxStderrBytes?: number;
}

export interface AdbLogcatCaptureResult {
  lines: string[];
  stderr: string;
  exitCode: number;
  signal?: string;
}

const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const MAX_PENDING_LINE_CHARS = 64 * 1024;

export class LogcatLineCollector {
  private readonly lines: string[] = [];
  private pending = '';

  constructor(private readonly filter: LogcatLineFilter) {}

  pushChunk(chunk: string): void {
    this.pending += chunk;
    let start = 0;
    let newline = this.pending.indexOf('\n', start);
    while (newline >= 0) {
      this.acceptLine(this.pending.slice(start, newline).replace(/\r$/, ''));
      start = newline + 1;
      newline = this.pending.indexOf('\n', start);
    }
    this.pending = this.pending.slice(start);
    if (this.pending.length > MAX_PENDING_LINE_CHARS) {
      this.pending = this.pending.slice(-MAX_PENDING_LINE_CHARS);
    }
  }

  finish(): string[] {
    if (this.pending.length > 0) {
      this.acceptLine(this.pending.replace(/\r$/, ''));
      this.pending = '';
    }
    return [...this.lines];
  }

  private acceptLine(line: string): void {
    if (!line.trim()) return;
    if (this.filter.pid && !line.includes(` ${this.filter.pid} `)) return;
    if (this.filter.packageName && !this.filter.pid && !line.includes(this.filter.packageName)) {
      return;
    }
    if (this.filter.pattern && !this.filter.pattern.test(line)) return;
    if (this.filter.predicate && !this.filter.predicate(line)) return;

    this.lines.push(line);
    if (this.lines.length > this.filter.maxLines) {
      this.lines.splice(0, this.lines.length - this.filter.maxLines);
    }
  }
}

export async function captureAdbLogcat(
  options: AdbLogcatCaptureOptions,
): Promise<AdbLogcatCaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.adb, options.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collector = new LogcatLineCollector(options);
    const stderrParts: string[] = [];
    let stderrBytes = 0;
    const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill();
    }, options.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => collector.pushChunk(chunk));

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderrBytes >= maxStderrBytes) return;
      const remaining = maxStderrBytes - stderrBytes;
      const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      stderrParts.push(slice);
      stderrBytes += slice.length;
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        lines: collector.finish(),
        stderr: stderrParts.join(''),
        exitCode: code ?? (signal ? 1 : 0),
        ...(signal ? { signal } : {}),
      });
    });
  });
}
