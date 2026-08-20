import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import type { NetworkHandlerDeps } from './shared';
import { parseBooleanArg, parseNumberArg } from './shared';
import { asOptionalString } from '../handlers.base.types';

export async function handleNetworkGetResponseBody(
  deps: NetworkHandlerDeps,
  args: Record<string, unknown>,
  ensureNetworkEnabled: (options: { autoEnable: boolean; enableExceptions: boolean }) => Promise<{
    enabled: boolean;
    autoEnabled: boolean;
    error?: string;
  }>,
): Promise<ToolResponse> {
  try {
    const requestId = asOptionalString(args.requestId) || '';
    const maxSize = parseNumberArg(args.maxSize, {
      defaultValue: 100000,
      min: 1024,
      max: 20 * 1024 * 1024,
      integer: true,
    });
    const returnSummary = parseBooleanArg(args.returnSummary, false);
    const retries = parseNumberArg(args.retries, {
      defaultValue: 3,
      min: 0,
      max: 10,
      integer: true,
    });
    const retryIntervalMs = parseNumberArg(args.retryIntervalMs, {
      defaultValue: 500,
      min: 50,
      max: 5000,
      integer: true,
    });
    const autoEnable = parseBooleanArg(args.autoEnable, false);
    const enableExceptions = parseBooleanArg(args.enableExceptions, true);

    if (!requestId) {
      return R.fail('requestId parameter is required')
        .set('hint', 'Get requestId from network_get_requests tool')
        .json();
    }

    const networkState = await ensureNetworkEnabled({
      autoEnable,
      enableExceptions,
    });

    if (!networkState.enabled) {
      return R.fail('Network monitoring is not enabled')
        .merge({
          hint: autoEnable
            ? 'Auto-enable failed. Check active page and call network_enable manually.'
            : 'Use network_enable tool first, or set autoEnable=true',
          detail: networkState.error,
        })
        .json();
    }

    let body: { body: string; base64Encoded: boolean } | null = null;
    let attemptsMade = 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      attemptsMade = attempt + 1;
      body = await deps.consoleMonitor.getResponseBody(requestId);
      if (body) {
        break;
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
      }
    }

    if (!body) {
      return R.fail(`No response body found for requestId: ${requestId}`)
        .merge({
          hint: 'The request may not have completed yet, or the requestId is invalid',
          attempts: attemptsMade,
          waitedMs: retries * retryIntervalMs,
          retryConfig: { retries, retryIntervalMs },
        })
        .json();
    }

    return buildResponseBodyResult(requestId, body, attemptsMade, maxSize, returnSummary);
  } catch (error) {
    return R.fail(error).json();
  }
}

function buildResponseBodyResult(
  requestId: string,
  body: { body: string; base64Encoded: boolean },
  attemptsMade: number,
  maxSize: number,
  returnSummary: boolean,
): ToolResponse {
  const originalSize = body.body.length;
  const isTooLarge = originalSize > maxSize;

  if (returnSummary || isTooLarge) {
    const preview = body.body.substring(0, 500);

    return R.ok()
      .merge({
        requestId,
        attempts: attemptsMade,
        summary: {
          size: originalSize,
          sizeKB: (originalSize / 1024).toFixed(2),
          base64Encoded: body.base64Encoded,
          preview: preview + (originalSize > 500 ? '...' : ''),
          truncated: isTooLarge,
          reason: isTooLarge
            ? `Response too large (${(originalSize / 1024).toFixed(2)} KB > ${(maxSize / 1024).toFixed(2)} KB)`
            : 'Summary mode enabled',
        },
        tip: isTooLarge
          ? 'Use collect_code tool to collect and compress this script, or increase maxSize parameter'
          : 'Set returnSummary=false to get full body',
      })
      .json();
  }

  return R.ok()
    .merge({
      requestId,
      attempts: attemptsMade,
      body: body.body,
      base64Encoded: body.base64Encoded,
      size: originalSize,
      sizeKB: (originalSize / 1024).toFixed(2),
    })
    .json();
}
