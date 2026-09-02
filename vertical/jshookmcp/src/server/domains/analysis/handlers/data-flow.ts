/**
 * Data flow analysis handler: analysis_data_flow
 *
 * Exposes the existing `analyzeDataFlowWithTaint` module as a user-facing tool,
 * returning the full graph (sources → sinks → tainted paths) with sanitizer pass-through detail.
 */

import { argString } from '@server/domains/shared/parse-args';
import { cpuLimit } from '@utils/concurrency';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import { analyzeDataFlowWithTaint } from '@modules/analyzer/CodeAnalyzerDataFlow';

export async function handleAnalysisDataFlow(args: ToolArgs): Promise<ToolResponse> {
  const code = argString(args, 'code');
  if (!code || code.trim().length === 0) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  return cpuLimit(async (): Promise<ToolResponse> => {
    const result = await analyzeDataFlowWithTaint(code);
    return asJsonResponse({
      success: true,
      ...result,
    });
  });
}
