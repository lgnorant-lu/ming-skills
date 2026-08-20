/**
 * AdvancedHandlersBase — top of the network domain handler chain.
 *
 * Inherits:
 *   NetworkHandlersCore       → shared utilities, network enable/disable/status/requests/response/stats
 *   NetworkHandlersPerformance → performance metrics, coverage, tracing, profiling
 *
 * This file adds: console exception/interceptor/tracer handlers.
 *
 * Split history:
 *   handlers.base.types.ts       — shared types, constants, type guards
 *   handlers.base.core.ts        — NetworkHandlersCore (base class)
 *   handlers.base.performance.ts — NetworkHandlersPerformance (extends Core)
 *   handlers.base.ts             — AdvancedHandlersBase (extends Performance) ← this file
 */

import { NetworkHandlersPerformance } from './handlers.base.performance';
import { asOptionalString } from './handlers.base.types';
import { argBool } from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';

export class AdvancedHandlersBase extends NetworkHandlersPerformance {
  async handleConsoleGetExceptions(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const url = asOptionalString(args.url);
      const limit = this.parseNumberArg(args.limit, {
        defaultValue: 50,
        min: 1,
        max: 1000,
        integer: true,
      });
      let exceptions = this.consoleMonitor.getExceptions();
      if (url) exceptions = exceptions.filter((ex) => ex.url?.includes(url));
      exceptions = exceptions.slice(0, limit);
      return { exceptions, total: exceptions.length };
    });
  }

  async handleConsoleInjectScriptMonitor(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const persistent = argBool(args, 'persistent', false);
      await this.consoleMonitor.enableDynamicScriptMonitoring({ persistent });
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
      await this.consoleMonitor.injectXHRInterceptor({ persistent });
      return {
        message: persistent ? 'XHR interceptor injected (persistent)' : 'XHR interceptor injected',
      };
    });
  }

  async handleConsoleInjectFetchInterceptor(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const persistent = argBool(args, 'persistent', false);
      await this.consoleMonitor.injectFetchInterceptor({ persistent });
      return {
        message: persistent
          ? 'Fetch interceptor injected (persistent)'
          : 'Fetch interceptor injected',
      };
    });
  }

  async handleConsoleClearInjectedBuffers(_args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const result = await this.consoleMonitor.clearInjectedBuffers();
      return { message: 'Injected buffers cleared', ...(result as Record<string, unknown>) };
    });
  }

  async handleConsoleResetInjectedInterceptors(
    _args: Record<string, unknown>,
  ): Promise<ToolResponse> {
    return handleSafe(async () => {
      const result = await this.consoleMonitor.resetInjectedInterceptors();
      return {
        message: 'Injected interceptors/monitors reset',
        ...(result as Record<string, unknown>),
      };
    });
  }

  async handleConsoleInjectFunctionTracer(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const functionName = asOptionalString(args.functionName) || '';
      if (!functionName) throw new Error('functionName is required');
      const persistent = argBool(args, 'persistent', false);
      await this.consoleMonitor.injectFunctionTracer(functionName, { persistent });
      return {
        message: persistent
          ? `Function tracer injected for: ${functionName} (persistent — survives navigations)`
          : `Function tracer injected for: ${functionName}`,
      };
    });
  }
}
