/**
 * Cross-platform hardware breakpoint engine factory.
 *
 * Selects the platform-specific engine at construction time based on
 * `process.platform`. Exposes the same API as HardwareBreakpointEngine
 * so it is a drop-in replacement in the memory domain manifest.
 *
 *   Win32  → HardwareBreakpointEngine  (DR0-DR3 via Win32 debug API)
 *   Linux  → LinuxBreakpointEngine     (DR0-DR3 via ptrace PTRACE_POKEUSER)
 *   Darwin → DarwinBreakpointEngine    (ARM64 DBGBVR/DBGWVR via Mach)
 *
 * @module CrossPlatformBreakpointEngine
 */

import { ToolError } from '@errors/ToolError';
import { readEnvString } from '@src/config/environment';
import type {
  BreakpointAccess,
  BreakpointConfig,
  BreakpointHit,
  BreakpointListEntry,
  BreakpointSize,
} from './HardwareBreakpoint.types';

// ── shared engine interface (structural — no named interface needed) ───

interface IBreakpointEngine {
  attach(pid: number): Promise<void>;
  detach(pid: number): Promise<void>;
  setBreakpoint(
    pid: number,
    address: string,
    access: BreakpointAccess,
    size?: BreakpointSize,
  ): Promise<BreakpointConfig>;
  removeBreakpoint(id: string): Promise<boolean>;
  listBreakpoints(): BreakpointListEntry[];
  waitForHit(timeoutMs?: number): Promise<BreakpointHit | null>;
  traceAccess(
    pid: number,
    address: string,
    access: BreakpointAccess,
    maxHits?: number,
    timeoutMs?: number,
  ): Promise<BreakpointHit[]>;
}

export class CrossPlatformBreakpointEngine {
  private engine: IBreakpointEngine | null = null;
  private readonly platform: string;

  constructor() {
    const configuredPlatform = readEnvString('JSHOOK_REGISTRY_PLATFORM', '', { trim: true });
    this.platform =
      configuredPlatform === 'win32' ||
      configuredPlatform === 'linux' ||
      configuredPlatform === 'darwin'
        ? configuredPlatform
        : process.platform;
  }

  private async ensureEngine(): Promise<IBreakpointEngine> {
    if (this.engine) return this.engine;

    if (this.platform === 'win32') {
      const { hardwareBreakpointEngine } = await import('./HardwareBreakpoint');
      this.engine = hardwareBreakpointEngine;
    } else if (this.platform === 'linux') {
      const { LinuxBreakpointEngine } = await import('./platform/LinuxBreakpointEngine');
      this.engine = new LinuxBreakpointEngine();
    } else if (this.platform === 'darwin') {
      const { DarwinBreakpointEngine } = await import('./platform/DarwinBreakpointEngine');
      this.engine = new DarwinBreakpointEngine();
    } else {
      throw new ToolError(
        'PREREQUISITE',
        `Hardware breakpoints are only supported on Windows, Linux, and macOS. ` +
          `Current platform: ${this.platform}`,
      );
    }

    return this.engine;
  }

  async attach(pid: number): Promise<void> {
    return (await this.ensureEngine()).attach(pid);
  }

  async detach(pid: number): Promise<void> {
    return (await this.ensureEngine()).detach(pid);
  }

  async setBreakpoint(
    pid: number,
    address: string,
    access: BreakpointAccess,
    size: BreakpointSize = 4,
  ): Promise<BreakpointConfig> {
    return (await this.ensureEngine()).setBreakpoint(pid, address, access, size);
  }

  async removeBreakpoint(id: string): Promise<boolean> {
    return (await this.ensureEngine()).removeBreakpoint(id);
  }

  listBreakpoints(): BreakpointListEntry[] {
    // listBreakpoints is synchronous — if engine hasn't loaded yet there are no
    // breakpoints to list. Return empty array.
    if (!this.engine) return [];
    return this.engine.listBreakpoints();
  }

  async waitForHit(timeoutMs?: number): Promise<BreakpointHit | null> {
    return (await this.ensureEngine()).waitForHit(timeoutMs);
  }

  async traceAccess(
    pid: number,
    address: string,
    access: BreakpointAccess,
    maxHits?: number,
    timeoutMs?: number,
  ): Promise<BreakpointHit[]> {
    return (await this.ensureEngine()).traceAccess(pid, address, access, maxHits, timeoutMs);
  }
}

/** Singleton convenience export (matching hardwareBreakpointEngine pattern). */
export const crossPlatformBreakpointEngine = new CrossPlatformBreakpointEngine();
