/**
 * Core network handlers — enable/disable/status/requests/response/stats.
 *
 * Extracted from NetworkHandlersCore (handlers.base.core.ts).
 */

import type { ToolResponse } from '@server/types';
import type { NetworkHandlerDeps } from './shared';
import { getDetailedDataManager } from './shared';
import { getMergedNetworkRequestsFromMonitor } from '../request-merge';
import type { NetworkRequestPayload } from '../handlers.base.types';
import {
  handleNetworkMonitor,
  handleNetworkEnable,
  handleNetworkDisable,
  handleNetworkGetStatus,
} from './core-handlers.status';
import { handleNetworkGetStats } from './core-handlers.stats';
import { handleNetworkGetResponseBody } from './core-handlers.response-body';
import { handleNetworkGetRequests } from './core-handlers.requests';
import { ensureNetworkEnabled, buildNotEnabledResponse } from './core-handlers.helpers';

export class CoreHandlers {
  private detailedDataManager = getDetailedDataManager();

  constructor(private deps: NetworkHandlerDeps) {}

  // ── Network enable/disable/status ──

  async handleNetworkMonitor(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleNetworkMonitor(this.deps, args);
  }

  async handleNetworkEnable(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleNetworkEnable(this.deps, args);
  }

  async handleNetworkDisable(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleNetworkDisable(this.deps, args);
  }

  async handleNetworkGetStatus(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleNetworkGetStatus(this.deps, args);
  }

  // ── Network requests ──

  private async getMergedNetworkRequests(): Promise<NetworkRequestPayload[]> {
    return (await getMergedNetworkRequestsFromMonitor(
      this.deps.consoleMonitor,
    )) as NetworkRequestPayload[];
  }

  async handleNetworkGetRequests(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleNetworkGetRequests(
      () => this.getMergedNetworkRequests(),
      (options) => ensureNetworkEnabled(this.deps, options),
      buildNotEnabledResponse,
      this.detailedDataManager,
      args,
    );
  }

  async handleNetworkGetResponseBody(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleNetworkGetResponseBody(this.deps, args, (options) =>
      ensureNetworkEnabled(this.deps, options),
    );
  }

  async handleNetworkGetStats(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleNetworkGetStats(this.deps, args);
  }
}
