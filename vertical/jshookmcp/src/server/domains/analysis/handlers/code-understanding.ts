/**
 * Code understanding handlers: understand_code, detect_crypto, detect_obfuscation
 */

import { argBool, argEnum, argObject } from '@server/domains/shared/parse-args';
import { asJsonResponse, asTextResponse } from '@server/domains/shared/response';
import type {
  CodeAnalyzer,
  CryptoDetector,
  ObfuscationDetector,
} from '@server/domains/shared/modules';
import type { ToolArgs, ToolResponse } from '@server/types';

const FOCUS_MODES = new Set(['structure', 'business', 'security', 'all'] as const);

function requireCodeArg(args: ToolArgs, _toolName: string): string | null {
  const code = args.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return null;
  }
  return code;
}

export async function handleUnderstandCode(
  args: ToolArgs,
  analyzer: CodeAnalyzer,
): Promise<ToolResponse> {
  const code = requireCodeArg(args, 'understand_code');
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  const result = await analyzer.understand({
    code,
    context: argObject(args, 'context'),
    focus: argEnum(args, 'focus', FOCUS_MODES, 'all'),
  });

  return asJsonResponse(result);
}

export async function handleDetectCrypto(
  args: ToolArgs,
  cryptoDetector: CryptoDetector,
): Promise<ToolResponse> {
  const code = requireCodeArg(args, 'detect_crypto');
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  const result = await cryptoDetector.detect({
    code,
  });

  return asJsonResponse(result);
}

export async function handleDetectObfuscation(
  args: ToolArgs,
  obfuscationDetector: ObfuscationDetector,
): Promise<ToolResponse> {
  const code = requireCodeArg(args, 'detect_obfuscation');
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  const generateReport = argBool(args, 'generateReport', true);
  const result = obfuscationDetector.detect(code);

  if (!generateReport) {
    return asJsonResponse(result);
  }

  const report = obfuscationDetector.generateReport(result);
  return asTextResponse(`${JSON.stringify(result, null, 2)}\n\n${report}`);
}
