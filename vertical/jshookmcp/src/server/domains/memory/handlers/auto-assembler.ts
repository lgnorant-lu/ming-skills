/**
 * Auto Assembler handler — bridges the AA engine to native memory operations.
 */

import type { CodeInjector } from '@native/CodeInjector';
import type { MemoryScanner } from '@native/MemoryScanner';
import type { MemoryController } from '@native/MemoryController';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import { autoAssembler } from '@native/AutoAssembler';
import type {
  AAExecutionContext,
  AAExecuteResult,
  AADisableScript,
  AACommandResult,
} from '@native/AutoAssembler.types';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argString } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { readEnvString } from '@src/config/environment';

const TOOL_AA = 'memory_auto_assemble';
const TOOL_AA_DISABLE = 'memory_auto_assemble_disable';

const INJECTION_ENV_GATE = 'JSHOOK_INJECTION_ENABLE';

function assertInjectionEnabled(): void {
  if (readEnvString(INJECTION_ENV_GATE, '') !== '1') {
    throw new Error(
      `Auto Assembler tools require ${INJECTION_ENV_GATE}=1 environment variable. ` +
        `Set this to enable memory_auto_assemble and memory_auto_assemble_disable.`,
    );
  }
}

// Memory I/O still via MemoryController / Win32API (synchronous koffi) — not yet
// migrated to createPlatformProvider(); see a4-01/b3-09 (commit c047a09b).
export class AutoAssemblerHandlers {
  private readonly injector: CodeInjector;
  private readonly scanner: MemoryScanner;
  private readonly memCtrl: MemoryController;
  private readonly processManager?: UnifiedProcessManager;
  constructor(
    injector: CodeInjector,
    scanner: MemoryScanner,
    memCtrl: MemoryController,
    processManager?: UnifiedProcessManager,
  ) {
    this.injector = injector;
    this.scanner = scanner;
    this.memCtrl = memCtrl;
    this.processManager = processManager;
  }

  private async resolvePid(raw: unknown): Promise<number> {
    return resolveMemoryDomainPid(raw, this.processManager);
  }

  /** Build the execution context that bridges AA engine to native modules. */
  private buildContext(pid: number): AAExecutionContext {
    return {
      pid,
      allocate: async (size: number): Promise<bigint> => {
        const addrStr = await this.injector.allocateRemote(pid, size);
        return BigInt(addrStr);
      },
      free: async (address: bigint): Promise<boolean> => {
        const addrStr = `0x${address.toString(16).toUpperCase()}`;
        return this.injector.freeRemote(pid, addrStr, 0);
      },
      protect: async (address: bigint, size: number, _protection: number): Promise<void> => {
        // Use codeInjector's existing mechanism — patchBytes temporarily changes protection
        // For FULLACCESS we just verify the address is valid by reading/writing
        // The actual protection change is done by VirtualProtectEx
        const { openProcessForMemory, CloseHandle, VirtualProtectEx } =
          await import('@native/Win32API');
        const handle = openProcessForMemory(pid, true);
        try {
          const { success } = VirtualProtectEx(handle, address, size, 0x40); // PAGE_EXECUTE_READWRITE
          if (!success) {
            throw new Error(`VirtualProtectEx failed for 0x${address.toString(16)}`);
          }
        } finally {
          CloseHandle(handle);
        }
      },
      read: async (address: bigint, size: number): Promise<Buffer> => {
        const addrStr = `0x${address.toString(16).toUpperCase()}`;
        return this.memCtrl.dumpMemory(pid, addrStr, size);
      },
      write: async (address: bigint, data: Buffer): Promise<void> => {
        const { openProcessForMemory, CloseHandle, WriteProcessMemory, VirtualProtectEx, PAGE } =
          await import('@native/Win32API');
        const handle = openProcessForMemory(pid, true);
        try {
          const { success: protOk, oldProtect } = VirtualProtectEx(
            handle,
            address,
            data.length,
            PAGE.READWRITE,
          );
          try {
            WriteProcessMemory(handle, address, data);
          } finally {
            if (protOk) {
              VirtualProtectEx(handle, address, data.length, oldProtect);
            }
          }
        } finally {
          CloseHandle(handle);
        }
      },
      aobScan: async (pattern: string): Promise<bigint[]> => {
        const result = await this.scanner.aobScan(pid, pattern, { maxResults: 1 });
        return result.matches.map((m: string) => BigInt(m));
      },
      createThread: async (address: bigint): Promise<void> => {
        const { openProcessForMemory, CloseHandle, CreateRemoteThread } =
          await import('@native/Win32API');
        const handle = openProcessForMemory(pid, true);
        try {
          const { handle: threadHandle } = CreateRemoteThread(handle, address, 0n);
          if (threadHandle !== 0n) {
            CloseHandle(threadHandle);
          }
        } finally {
          CloseHandle(handle);
        }
      },
    };
  }

  async handleAutoAssemble(args: Record<string, unknown>): Promise<unknown> {
    return handleSafe(async () => {
      assertInjectionEnabled();
      const pid = await this.resolvePid(args.pid);
      const script = argString(args, 'script') ?? '';

      if (script.trim().length === 0) {
        throw new Error(`${TOOL_AA}: "script" must be a non-empty AA script string`);
      }

      const ctx = this.buildContext(pid);
      const result: AAExecuteResult = await autoAssembler.execute(script, ctx);

      if (!result.success) {
        const failedCmd = result.enableResults.find((r) => !r.success);
        const errMsg = failedCmd?.message ?? 'Unknown error';
        logger.warn(`${TOOL_AA}: script failed — ${errMsg}`);
        return {
          success: false,
          error: errMsg,
          enableResults: result.enableResults,
          allocations: result.allocations,
          symbols: result.symbols,
          labels: result.labels,
          hint: 'AA script failed. Check enableResults for details. Allocations made before failure are tracked in allocations.',
        };
      }

      return {
        success: true,
        enableResults: result.enableResults,
        disableScript: JSON.stringify(result.disableScript),
        allocations: result.allocations,
        symbols: result.symbols,
        labels: result.labels,
        hint: `${result.enableResults.length} commands executed. Save disableScript for cleanup with memory_auto_assemble_disable.`,
      };
    });
  }

  async handleAutoAssembleDisable(args: Record<string, unknown>): Promise<unknown> {
    return handleSafe(async () => {
      assertInjectionEnabled();
      const pid = await this.resolvePid(args.pid);
      const disableScriptRaw = argString(args, 'disableScript') ?? '';

      if (disableScriptRaw.trim().length === 0) {
        throw new Error(`${TOOL_AA_DISABLE}: "disableScript" must be a non-empty JSON string`);
      }

      let disableScript: AADisableScript;
      try {
        disableScript = JSON.parse(disableScriptRaw) as AADisableScript;
      } catch {
        throw new Error(`${TOOL_AA_DISABLE}: "disableScript" is not valid JSON`);
      }

      if (!disableScript.disableCommands || !Array.isArray(disableScript.disableCommands)) {
        throw new Error(
          `${TOOL_AA_DISABLE}: "disableScript" is missing required "disableCommands" array`,
        );
      }

      // Use the pid from the disable script, falling back to the passed pid
      const effectivePid = disableScript.pid || pid;
      const ctx = this.buildContext(effectivePid);
      const results: AACommandResult[] = await autoAssembler.executeDisable(disableScript, ctx);

      const failedCmds = results.filter((r) => !r.success);
      const allOk = failedCmds.length === 0;

      return {
        success: allOk,
        disableResults: results,
        failedCommands: failedCmds.length > 0 ? failedCmds : undefined,
        hint: allOk
          ? `${results.length} disable commands executed successfully.`
          : `${failedCmds.length}/${results.length} commands failed. See disableResults for details.`,
      };
    });
  }
}
