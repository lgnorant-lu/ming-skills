/**
 * Mono domain handlers — memory_mono_detect, memory_mono_assemblies,
 * memory_mono_classes, memory_mono_objects, memory_mono_fields, memory_mono_methods.
 *
 * Delegates to MonoAnalyzer for Unity/Mono game runtime introspection.
 * All tools are Win32-only (mono-2.0-bdwgc.dll is a Windows module);
 * the MonoAnalyzer singleton is lazily imported on first call.
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { argString, argNumber } from '@server/domains/shared/parse-args';
import { requireStringArg, validateHexAddress } from './validation';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { MonoAnalyzer } from '@native/MonoAnalyzer';

export class MonoHandlers {
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext | null;
  private analyzerInstance: MonoAnalyzer | null = null;

  constructor(processManager?: UnifiedProcessManager, ctx?: MCPServerContext | null) {
    this.processManager = processManager;
    this.ctx = ctx;
  }

  private async getAnalyzer(): Promise<MonoAnalyzer> {
    if (!this.analyzerInstance) {
      const { monoAnalyzer } = await import('@native/MonoAnalyzer');
      this.analyzerInstance = monoAnalyzer;
    }
    return this.analyzerInstance;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  async handleMonoDetect(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const analyzer = await this.getAnalyzer();
      return analyzer.detectRuntime(pid);
    });
  }

  async handleMonoAssemblies(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const nameFilter = argString(args, 'nameFilter');
      const analyzer = await this.getAnalyzer();
      const assemblies = await analyzer.listAssemblies(pid);
      if (nameFilter) {
        const lower = nameFilter.toLowerCase();
        return assemblies.filter((a) => a.name.toLowerCase().includes(lower));
      }
      return assemblies;
    });
  }

  async handleMonoClasses(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const assemblyName = requireStringArg(
        args.assemblyName,
        'assemblyName',
        'memory_mono_classes',
      );
      const namespaceFilter = argString(args, 'namespaceFilter');
      const maxResults = argNumber(args, 'maxResults', 500);
      const analyzer = await this.getAnalyzer();
      const classes = await analyzer.listClasses(pid, assemblyName, namespaceFilter);
      return classes.slice(0, maxResults);
    });
  }

  async handleMonoObjects(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const className = requireStringArg(args.className, 'className', 'memory_mono_objects');
      const maxResults = argNumber(args, 'maxResults', 100);
      const analyzer = await this.getAnalyzer();
      const objects = await analyzer.findObjects(pid, className);
      return objects.slice(0, maxResults);
    });
  }

  async handleMonoFields(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const analyzer = await this.getAnalyzer();
      return analyzer.readFields(pid, address);
    });
  }

  async handleMonoMethods(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const assemblyName = requireStringArg(
        args.assemblyName,
        'assemblyName',
        'memory_mono_methods',
      );
      const className = requireStringArg(args.className, 'className', 'memory_mono_methods');
      // MonoAnalyzer does not yet expose a listMethods method.
      // Use memory_mono_classes to inspect methodCount per class.
      const analyzer = await this.getAnalyzer();
      const classes = await analyzer.listClasses(pid, assemblyName);
      const target = classes.find((c) => c.name.toLowerCase().includes(className.toLowerCase()));
      if (!target) {
        throw new Error(
          `Class matching "${className}" not found in assembly "${assemblyName}". ` +
            `Found: ${classes.map((c) => c.fullName).join(', ') || 'none'}`,
        );
      }
      return {
        className: target.fullName,
        methodCount: target.methodCount,
        note:
          'MonoAnalyzer does not yet support enumerating individual method names. ' +
          'The Mono runtime stores methods in a MonoMethod table indexed by token; ' +
          'full method name/signature enumeration requires walking this table from ' +
          'MonoImage, which is not yet implemented.',
      };
    });
  }
}
