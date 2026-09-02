/**
 * Security scan handler: analysis_security_scan
 *
 * Exposes the existing `identifySecurityRisks` module as a user-facing tool.
 * Returns a structured list of vulnerabilities with severity, location, and recommendations.
 */

import { cpuLimit } from '@utils/concurrency';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import { identifySecurityRisks } from '@modules/analyzer/SecurityCodeAnalyzer';
import { requireCodeArg } from './shared';

export async function handleAnalysisSecurityScan(args: ToolArgs): Promise<ToolResponse> {
  const code = requireCodeArg(args);
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  return cpuLimit(async (): Promise<ToolResponse> => {
    const risks = identifySecurityRisks(code, {});
    return asJsonResponse({
      success: true,
      risks,
      riskCount: risks.length,
      severities: {
        critical: risks.filter((r) => r.severity === 'critical').length,
        high: risks.filter((r) => r.severity === 'high').length,
        medium: risks.filter((r) => r.severity === 'medium').length,
        low: risks.filter((r) => r.severity === 'low').length,
      },
    });
  });
}
