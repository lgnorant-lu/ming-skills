import type { NetworkHandlerDeps } from './shared';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';

export async function ensureNetworkEnabled(
  deps: NetworkHandlerDeps,
  options: {
    autoEnable: boolean;
    enableExceptions: boolean;
  },
): Promise<{ enabled: boolean; autoEnabled: boolean; error?: string }> {
  if (deps.consoleMonitor.isNetworkEnabled()) {
    return { enabled: true, autoEnabled: false };
  }

  if (!options.autoEnable) {
    return { enabled: false, autoEnabled: false };
  }

  try {
    await deps.consoleMonitor.enable({
      enableNetwork: true,
      enableExceptions: options.enableExceptions,
    });
    return {
      enabled: deps.consoleMonitor.isNetworkEnabled(),
      autoEnabled: true,
    };
  } catch (error) {
    return {
      enabled: false,
      autoEnabled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildNotEnabledResponse(autoEnable: boolean, error?: string): ToolResponse {
  if (autoEnable && error) {
    return R.fail('Failed to auto-enable network monitoring')
      .merge({
        detail: error,
        solution: {
          step1: 'Ensure browser page is active and reachable',
          step2: 'Call network_enable manually',
          step3: 'Navigate to target page: page_navigate(url)',
          step4: 'Get requests: network_get_requests',
        },
      })
      .json();
  }

  return R.fail(' Network monitoring is not enabled')
    .merge({
      requests: [],
      total: 0,
      solution: {
        step1: 'Enable network monitoring: network_enable',
        step2: 'Navigate to target page: page_navigate(url)',
        step3: 'Get requests: network_get_requests',
      },
      tip: 'Set autoEnable=true to auto-enable monitoring in this call',
    })
    .json();
}

export function getMergedNetworkRequestsFromMonitor(
  monitor: NetworkHandlerDeps['consoleMonitor'],
): Promise<unknown[]> {
  // Re-export from request-merge to avoid circular dependency
  return Promise.resolve(monitor.getNetworkRequests());
}
