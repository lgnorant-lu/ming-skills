/**
 * JSVMP handlers: js_deobfuscate_jsvmp, js_analyze_vm
 */

import { argBool, argNumber } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import { JSVMPDeobfuscator } from '@modules/deobfuscator/JSVMPDeobfuscator';
import { buildVmAnalysisResponse } from '@server/domains/analysis/handlers/vm-analysis';

function requireCodeArg(args: ToolArgs, _toolName: string): string | null {
  const code = args.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return null;
  }
  return code;
}

export async function handleJsDeobfuscateJsvmp(
  args: ToolArgs,
  jsvmpDeobfuscator: JSVMPDeobfuscator,
): Promise<ToolResponse> {
  const code = requireCodeArg(args, 'js_deobfuscate_jsvmp');
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  const detectOnly = argBool(args, 'detectOnly', false);
  const result = await jsvmpDeobfuscator.deobfuscate({
    code,
    aggressive: argBool(args, 'aggressive', false),
    extractInstructions: argBool(args, 'extractInstructions', true),
    timeout: argNumber(args, 'timeout', 30000),
  });

  if (detectOnly) {
    return asJsonResponse({
      success: true,
      isJSVMP: result.isJSVMP,
      vmType: result.vmType,
      vmFeatures: result.vmFeatures,
      confidence: result.confidence,
      instructionCount: result.instructions?.length,
    });
  }

  return asJsonResponse({
    success: result.isJSVMP,
    isJSVMP: result.isJSVMP,
    vmType: result.vmType,
    vmFeatures: result.vmFeatures,
    instructions: result.instructions,
    deobfuscatedCode: result.deobfuscatedCode,
    confidence: result.confidence,
    warnings: result.warnings,
    unresolvedParts: result.unresolvedParts,
    stats: result.stats,
  });
}

export async function handleJsAnalyzeVm(
  args: ToolArgs,
  jsvmpDeobfuscator: JSVMPDeobfuscator,
): Promise<ToolResponse> {
  const code = requireCodeArg(args, 'js_analyze_vm');
  if (!code) {
    return asJsonResponse({ success: false, error: 'code is required' });
  }

  const extractBytecode = argBool(args, 'extractBytecode', true);
  const mapOpcodes = argBool(args, 'mapOpcodes', true);

  const vmResult = await jsvmpDeobfuscator.deobfuscate({
    code,
    aggressive: false,
    extractInstructions: extractBytecode,
    timeout: 15000,
  });
  return asJsonResponse(
    buildVmAnalysisResponse({
      code,
      extractBytecode,
      mapOpcodes,
      vmResult,
    }),
  );
}
