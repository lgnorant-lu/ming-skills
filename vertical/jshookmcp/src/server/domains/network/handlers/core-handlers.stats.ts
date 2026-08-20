import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import type { NetworkHandlerDeps } from './shared';
import {
  isNetworkRequestPayload,
  isNetworkResponsePayload,
  isFiniteNumber,
} from '../handlers.base.types';
import type { NetworkRequestPayload } from '../handlers.base.types';

export async function handleNetworkGetStats(
  deps: NetworkHandlerDeps,
  _args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    if (!deps.consoleMonitor.isNetworkEnabled()) {
      throw new Error('Network monitoring is not enabled. Use network_enable tool first');
    }

    const requests = deps.consoleMonitor
      .getNetworkRequests()
      .filter((req: unknown): req is NetworkRequestPayload => isNetworkRequestPayload(req));
    const responses = deps.consoleMonitor.getNetworkResponses().filter(isNetworkResponsePayload);

    const byMethod: Record<string, number> = {};
    requests.forEach((req) => {
      byMethod[req.method] = (byMethod[req.method] || 0) + 1;
    });

    const byStatus: Record<number, number> = {};
    responses.forEach((res) => {
      byStatus[res.status] = (byStatus[res.status] || 0) + 1;
    });

    const byType: Record<string, number> = {};
    requests.forEach((req) => {
      const type = req.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    });

    const timestamps = requests
      .map((r) => r.timestamp)
      .filter((t): t is number => isFiniteNumber(t));
    const timeStats =
      timestamps.length > 0
        ? {
            earliest: Math.min(...timestamps),
            latest: Math.max(...timestamps),
            duration: Math.max(...timestamps) - Math.min(...timestamps),
          }
        : null;

    return {
      stats: {
        totalRequests: requests.length,
        totalResponses: responses.length,
        byMethod,
        byStatus,
        byType,
        timeStats,
        monitoringEnabled: true,
      },
    };
  });
}
