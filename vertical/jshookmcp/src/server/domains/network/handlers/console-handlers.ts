/**
 * Console exception, interceptor, tracer, and monitoring handlers.
 *
 * Extracted from AdvancedHandlersBase (handlers.base.ts).
 */

import { asOptionalString } from '../handlers.base.types';
import { argBool } from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import { parseNumberArg } from './shared';
import type { ConsoleMonitor } from '@server/domains/shared/modules/collector';

export interface ConsoleHandlerDeps {
  consoleMonitor: ConsoleMonitor;
}

export class ConsoleHandlers {
  constructor(private deps: ConsoleHandlerDeps) {}

  async handleConsoleGetExceptions(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const url = asOptionalString(args.url);
      const limit = parseNumberArg(args.limit, {
        defaultValue: 50,
        min: 1,
        max: 1000,
        integer: true,
      });

      let exceptions = this.deps.consoleMonitor.getExceptions();

      if (url) {
        exceptions = exceptions.filter((ex) => ex.url?.includes(url));
      }

      exceptions = exceptions.slice(0, limit);

      return {
        exceptions,
        total: exceptions.length,
      };
    });
  }

  async handleConsoleInjectScriptMonitor(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const persistent = argBool(args, 'persistent', false);
      await this.deps.consoleMonitor.enableDynamicScriptMonitoring({ persistent });

      return {
        message: persistent
          ? 'Dynamic script monitoring enabled (persistent — survives navigations)'
          : 'Dynamic script monitoring enabled',
      };
    });
  }

  async handleConsoleInjectXhrInterceptor(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const persistent = argBool(args, 'persistent', false);
      await this.deps.consoleMonitor.injectXHRInterceptor({ persistent });

      return {
        message: persistent ? 'XHR interceptor injected (persistent)' : 'XHR interceptor injected',
      };
    });
  }

  async handleConsoleInjectFetchInterceptor(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const persistent = argBool(args, 'persistent', false);
      await this.deps.consoleMonitor.injectFetchInterceptor({ persistent });

      return {
        message: persistent
          ? 'Fetch interceptor injected (persistent)'
          : 'Fetch interceptor injected',
      };
    });
  }

  async handleConsoleClearInjectedBuffers(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const result = await this.deps.consoleMonitor.clearInjectedBuffers();

      return {
        message: 'Injected buffers cleared',
        ...result,
      };
    });
  }

  async handleConsoleResetInjectedInterceptors(
    _args: Record<string, unknown>,
  ): Promise<ToolResponse> {
    return handleSafe(async () => {
      const result = await this.deps.consoleMonitor.resetInjectedInterceptors();

      return {
        message: 'Injected interceptors/monitors reset',
        ...result,
      };
    });
  }

  async handleConsoleInjectFunctionTracer(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const functionName = asOptionalString(args.functionName) || '';

      if (!functionName) {
        throw new Error('functionName is required');
      }

      const persistent = argBool(args, 'persistent', false);
      await this.deps.consoleMonitor.injectFunctionTracer(functionName, { persistent });

      return {
        message: persistent
          ? `Function tracer injected for: ${functionName} (persistent — survives navigations)`
          : `Function tracer injected for: ${functionName}`,
      };
    });
  }
}
