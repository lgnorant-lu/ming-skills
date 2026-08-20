/**
 * Pipeline handlers: js_deobfuscate_pipeline, js_solve_constraints
 */

import { argBool, argNumber } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import {
  applyConstantFold,
  applyControlFlowFlatten,
  applyDeadCodeRemove,
  applyRenameVars,
} from '@server/domains/analysis/handlers/inline-deobfuscation';
import { solveConstraints } from '@server/domains/analysis/handlers/solve-constraints';
import { runWebcrack } from '@modules/deobfuscator/webcrack';

function requireCodeArg(args: ToolArgs, _toolName: string): string | null {
  const code = args.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return null;
  }
  return code;
}

export async function handleJsDeobfuscatePipeline(args: ToolArgs): Promise<ToolResponse> {
  const code = requireCodeArg(args, 'js_deobfuscate_pipeline');
  if (!code) {
    return asJsonResponse({ success: false, error: 'code is required' });
  }

  const useWebcrack = argBool(args, 'useWebcrack', true);
  const aggressive = argBool(args, 'aggressive', false);
  const humanize = argBool(args, 'humanize', true);
  const returnStageDetails = argBool(args, 'returnStageDetails', false);
  const startTime = Date.now();

  // Stage 1: Preprocessor — constant folding, dead code removal
  let preprocessed = code;
  const ppTransforms: string[] = [];

  const afterFold = applyConstantFold(preprocessed);
  if (afterFold !== preprocessed) {
    preprocessed = afterFold;
    ppTransforms.push('constant_fold');
  }

  const afterDeadCode = applyDeadCodeRemove(preprocessed);
  if (afterDeadCode !== preprocessed) {
    preprocessed = afterDeadCode;
    ppTransforms.push('dead_code_remove');
  }

  // Stage 2: Deobfuscator — webcrack
  let deobfuscated = preprocessed;
  let webcrackApplied = false;
  let webcrackWarning: string | undefined;
  let webcrackError: string | undefined;
  if (useWebcrack) {
    try {
      const result = await runWebcrack(preprocessed, { unminify: true, unpack: true });
      if (result.applied) {
        deobfuscated = result.code;
        webcrackApplied = true;
      } else {
        webcrackWarning = result.reason
          ? `webcrack stage did not apply: ${result.reason}`
          : 'webcrack stage did not apply any transformation.';
      }
    } catch (error) {
      webcrackError = error instanceof Error ? error.message : String(error);
    }
  }

  if (aggressive) {
    const afterCFF = applyControlFlowFlatten(deobfuscated);
    if (afterCFF !== deobfuscated) {
      deobfuscated = afterCFF;
    }
  }

  // Stage 3: Humanizer — variable renaming
  let humanized = deobfuscated;
  let renameCount = 0;
  if (humanize) {
    const result = applyRenameVars(humanized);
    if (result.code !== humanized) {
      humanized = result.code;
      renameCount = result.count;
    }
  }

  const totalMs = Date.now() - startTime;
  const reductionRate = code.length > 0 ? 1 - humanized.length / code.length : 0;
  const pipelineSuccess = !webcrackWarning && !webcrackError;

  const response: Record<string, unknown> = {
    success: pipelineSuccess,
    deobfuscatedCode: humanized,
    ...(webcrackWarning ? { warning: webcrackWarning } : {}),
    ...(webcrackError ? { error: `webcrack stage failed: ${webcrackError}` } : {}),
    stats: {
      originalSize: code.length,
      finalSize: humanized.length,
      reductionRate: Math.round(reductionRate * 1000) / 10,
      processingTimeMs: totalMs,
      stages: {
        preprocessor: { transforms: ppTransforms, sizeAfter: preprocessed.length },
        deobfuscator: {
          webcrackApplied,
          sizeAfter: deobfuscated.length,
          ...(webcrackWarning ? { warning: webcrackWarning } : {}),
          ...(webcrackError ? { error: webcrackError } : {}),
        },
        humanizer: { renameCount, sizeAfter: humanized.length },
      },
    },
  };

  if (returnStageDetails) {
    response.stageDetails = {
      preprocessed: preprocessed.substring(0, 5000),
      deobfuscated: deobfuscated.substring(0, 5000),
    };
  }

  return asJsonResponse(response);
}

export async function handleJsSolveConstraints(args: ToolArgs): Promise<ToolResponse> {
  const code = requireCodeArg(args, 'js_solve_constraints');
  if (!code) {
    return asJsonResponse({ success: false, error: 'code is required' });
  }

  const replaceInPlace = argBool(args, 'replaceInPlace', true);
  const maxIterations = argNumber(args, 'maxIterations', 100);

  return asJsonResponse(
    solveConstraints({
      code,
      replaceInPlace,
      maxIterations,
    }),
  );
}
