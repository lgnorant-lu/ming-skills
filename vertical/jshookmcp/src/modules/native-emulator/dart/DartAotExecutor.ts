/**
 * DartAotExecutor — Execute Dart AOT code in the ARM64 emulator.
 *
 * Orchestrates:
 *  1. Load snapshot via DartAotLoader
 *  2. Initialize CpuEngine with Dart runtime state
 *  3. Register Dart built-in stubs
 *  4. Execute functions by address or name
 *  5. Capture execution trace
 *
 * This is the **execution layer** that runs Dart code with simplified
 * runtime semantics (mock built-ins, tagged pointers, ObjectPool lookup).
 */

import { CpuEngine, type InstructionHook, type TraceEvent } from '../CpuEngine';
import { DartAotLoader, type LoadedSnapshot } from './DartAotLoader';
import { DartRuntime, DART_PP, DART_THR, DART_NULL, DART_HEAP_BASE } from './DartRuntime';
import { ObjectPoolRegistry } from './ObjectPool';
import { ToolError } from '@errors/ToolError';

/** Execution options for calling a Dart function. */
export interface DartCallOptions {
  /** Function entry point address (hex string or bigint). */
  address?: bigint;
  /** Function name (alternative to address). */
  name?: string;
  /** Function arguments (Dart tagged pointers). */
  args?: bigint[];
  /** Maximum instruction steps before timeout. */
  maxSteps?: number;
  /** Enable instruction trace capture. */
  trace?: boolean;
}

/** Execution result. */
export interface DartCallResult {
  /** Return value (x0 after function returns). */
  returnValue: bigint;
  /** Number of instructions executed. */
  steps: number;
  /** Instruction trace (if enabled). */
  trace?: Array<{
    pc: string;
    insn: string;
    step: number;
    registers?: Record<string, string>;
  }>;
  /** Error message (if execution failed). */
  error?: string;
}

export class DartAotExecutor {
  private snapshot?: LoadedSnapshot;
  private cpu?: CpuEngine;
  private dartRuntime?: DartRuntime;
  private poolRegistry?: ObjectPoolRegistry;

  /**
   * Load a Dart AOT snapshot and prepare for execution.
   *
   * @param path - Absolute path to APK or libapp.so
   */
  async load(path: string): Promise<void> {
    const loader = new DartAotLoader();
    const snapshot = await loader.loadSnapshot(path);
    this.initFromSnapshot(snapshot);
  }

  /**
   * Prepare for execution from an already-parsed snapshot.
   *
   * This is the cache-friendly entry point: a {@link DartSnapshotSessionManager}
   * parses `libapp.so` once and hands the resulting `LoadedSnapshot` to every
   * downstream call/trace invocation, skipping the repeated IO + cluster parse
   * that `load()` would otherwise redo. The CPU/runtime state is still
   * initialised fresh per executor (register state is per-call, never shared).
   */
  loadFromSnapshot(snapshot: LoadedSnapshot): void {
    this.initFromSnapshot(snapshot);
  }

  /**
   * Initialise CPU engine, Dart runtime, ObjectPool registry, and built-in
   * stubs from a parsed snapshot. Factored out of {@link load} so the
   * cache-backed {@link loadFromSnapshot} shares the exact same setup.
   */
  private initFromSnapshot(snapshot: LoadedSnapshot): void {
    this.snapshot = snapshot;

    // Initialize CPU engine
    this.cpu = new CpuEngine();

    // Load snapshot data into CPU memory
    // In a real implementation, we'd use loadElf() or map the snapshot
    // For now, we'll skip ELF loading and just set up runtime state

    // Initialize Dart runtime
    this.dartRuntime = new DartRuntime(this.cpu);

    // Mock Dart runtime state (real values would come from snapshot)
    const threadPtr = 0x7000_0000n; // Mock Thread object
    const nullObject = 0x1n; // Mock null object (tagged)
    const heapBase = 0x8000_0000n; // Mock heap base

    this.dartRuntime.initializeRuntime(threadPtr, 0n, nullObject, heapBase);

    // Build ObjectPool registry. The registry stores pools as raw bytes in the
    // ObjectPool on-disk layout (+0x00 u32 length, +0x04 padding, +0x08 8-byte
    // entries), so serialise the parsed entries — an all-zero buffer would make
    // every pool read as a header of zero entries.
    this.poolRegistry = new ObjectPoolRegistry();
    for (const { address, pool } of this.snapshot.objectPools) {
      const entries = pool.getAllEntries();
      const data = new Uint8Array(8 + entries.length * 8);
      const view = new DataView(data.buffer);
      view.setUint32(0, entries.length, true);
      for (let i = 0; i < entries.length; i++) {
        view.setBigUint64(8 + i * 8, entries[i]!.value, true);
      }
      this.poolRegistry.register(address, data);
    }

    // Register Dart built-in stubs
    this.registerBuiltinStubs();
  }

  /**
   * Call a Dart function by address or name.
   *
   * @param options - Call options
   * @returns Execution result
   */
  async call(options: DartCallOptions): Promise<DartCallResult> {
    if (!this.snapshot || !this.cpu || !this.dartRuntime) {
      throw new ToolError('RUNTIME', 'Snapshot not loaded. Call load() first.');
    }

    // Resolve function address
    let entryPoint: bigint;

    if (options.address) {
      entryPoint = options.address;
    } else if (options.name) {
      const loader = new DartAotLoader();
      const code = loader.findCodeByName(this.snapshot, options.name);
      if (!code) {
        throw new ToolError('NOT_FOUND', `Function not found: ${options.name}`);
      }
      entryPoint = code.entryPoint;
    } else {
      throw new ToolError('VALIDATION', 'Either address or name must be provided');
    }

    // Find the Code object to get its ObjectPool
    const loader = new DartAotLoader();
    const code = loader.findCodeByAddress(this.snapshot, entryPoint);
    if (code) {
      // Set PP register to this function's ObjectPool
      this.dartRuntime.setObjectPool(code.objectPool);
    }

    // Set up instruction trace if requested
    const trace: DartCallResult['trace'] = [];

    if (options.trace) {
      const hook: InstructionHook = (event: TraceEvent) => {
        const registers: Record<string, string> = {};
        for (let i = 0; i < 31; i++) {
          registers[`x${i}`] = `0x${event.x(i).toString(16)}`;
        }
        registers['sp'] = `0x${event.reg('sp').toString(16)}`;
        registers['pp'] = `0x${event.x(DART_PP).toString(16)}`;

        trace.push({
          pc: `0x${event.pc.toString(16)}`,
          insn: `0x${event.insn.toString(16)}`,
          step: event.step,
          registers,
        });
      };

      this.cpu.addInstructionHook(hook);
    }

    // Execute function
    let returnValue = 0n;
    let steps = 0;
    let error: string | undefined;

    try {
      // callGuestFunction → invokeGuest zeros x0–x28 before every call.
      // The Dart runtime registers (THR/PP/NULL/HEAP_BASE) MUST be passed
      // as initRegisters so they survive the zeroing loop — without them every
      // Dart AOT instruction that reads PP/THR would dereference address 0.
      const rawResult = this.cpu.callGuestFunction(
        Number(entryPoint),
        options.args ?? [],
        options.maxSteps,
        this.dartRuntime
          ? {
              [DART_THR]: this.dartRuntime.readDartRegister(DART_THR) ?? 0n,
              [DART_PP]: this.dartRuntime.readDartRegister(DART_PP) ?? 0n,
              [DART_NULL]: this.dartRuntime.readDartRegister(DART_NULL) ?? 0n,
              [DART_HEAP_BASE]: this.dartRuntime.readDartRegister(DART_HEAP_BASE) ?? 0n,
            }
          : undefined,
      );
      returnValue = BigInt(rawResult);
      // callGuestFunction returns only x0; per-step count is not exposed
      // through the public API. Use the trace length when available, otherwise
      // report -1 to signal "executed but steps unknown".
      steps = options.trace && trace.length > 0 ? trace.length : -1;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    return {
      returnValue,
      steps,
      trace: options.trace ? trace : undefined,
      error,
    };
  }

  /**
   * Register Dart built-in function stubs in the CPU.
   */
  private registerBuiltinStubs(): void {
    if (!this.cpu) return;

    // Register stubs for common Dart built-ins
    // In a real implementation, we'd:
    // 1. Find the GOT entries for these symbols
    // 2. Register host functions at those addresses
    // 3. The host functions call DartBuiltins.callDartBuiltin()

    // For now, this is a placeholder
  }

  /**
   * Get the loaded snapshot.
   */
  getSnapshot(): LoadedSnapshot | undefined {
    return this.snapshot;
  }

  /**
   * Get the CPU engine.
   */
  getCpu(): CpuEngine | undefined {
    return this.cpu;
  }

  /**
   * Get the Dart runtime.
   */
  getRuntime(): DartRuntime | undefined {
    return this.dartRuntime;
  }
}
