/**
 * Symbolic execution handlers: js_symbolic_execute, js_symbolic_execute_jsvmp
 */

import {
  argArray,
  argBool,
  argNumber,
  argString,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import { cpuLimit } from '@utils/concurrency';
import {
  SYMBOLIC_CLAMP_MAX_DEPTH,
  SYMBOLIC_CLAMP_MAX_PATHS,
  SYMBOLIC_CLAMP_MAX_STEPS,
  SYMBOLIC_CLAMP_TIMEOUT_MS,
} from '@src/constants';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import { SymbolicExecutor } from '@modules/symbolic/SymbolicExecutor';
import { JSVMPSymbolicExecutor } from '@modules/symbolic/JSVMPSymbolicExecutor';

/**
 * Clamp a user-supplied CPU budget to the server cap. Values at or under the
 * cap pass through untouched; oversized values are capped and recorded in
 * `clampedFields` so the response can carry a `clamped: true` marker.
 */
function clampBudget(
  value: number | undefined,
  cap: number,
  field: string,
  clampedFields: string[],
): number | undefined {
  if (value === undefined || value <= cap) return value;
  clampedFields.push(field);
  return cap;
}

export async function handleJsSymbolicExecute(args: ToolArgs): Promise<ToolResponse> {
  const code = argStringRequired(args, 'code');
  if (!code) return asJsonResponse({ success: false, error: 'code is required' });

  const enableConstraintSolving = argBool(args, 'enableConstraintSolving', false);
  const clampedFields: string[] = [];
  const maxPaths = clampBudget(
    argNumber(args, 'maxPaths'),
    SYMBOLIC_CLAMP_MAX_PATHS,
    'maxPaths',
    clampedFields,
  );
  const maxDepth = clampBudget(
    argNumber(args, 'maxDepth'),
    SYMBOLIC_CLAMP_MAX_DEPTH,
    'maxDepth',
    clampedFields,
  );
  const timeout = clampBudget(
    argNumber(args, 'timeout'),
    SYMBOLIC_CLAMP_TIMEOUT_MS,
    'timeout',
    clampedFields,
  );

  // cpuLimit sits INSIDE handleSafe so executor rejections keep their existing
  // error semantics (handleSafe converts them into failure responses).
  return handleSafe(async () => {
    const executor = new SymbolicExecutor();
    const result = await cpuLimit(() =>
      executor.execute({
        code,
        ...(maxPaths !== undefined ? { maxPaths } : {}),
        ...(maxDepth !== undefined ? { maxDepth } : {}),
        ...(timeout !== undefined ? { timeout } : {}),
        enableConstraintSolving,
      }),
    );
    return {
      ...(result as unknown as Record<string, unknown>),
      ...(clampedFields.length > 0 ? { clamped: true } : {}),
    };
  });
}

export async function handleJsSymbolicExecuteJsvmp(args: ToolArgs): Promise<ToolResponse> {
  const instructions = argArray(args, 'instructions');
  if (!instructions) {
    return asJsonResponse({
      success: false,
      error: 'instructions array is required (from js_analyze_vm output)',
    });
  }

  const vmType = argString(args, 'vmType') as import('@internal-types/vm').VMType | undefined;
  const clampedFields: string[] = [];
  const maxSteps = clampBudget(
    argNumber(args, 'maxSteps'),
    SYMBOLIC_CLAMP_MAX_STEPS,
    'maxSteps',
    clampedFields,
  );
  const timeout = clampBudget(
    argNumber(args, 'timeout'),
    SYMBOLIC_CLAMP_TIMEOUT_MS,
    'timeout',
    clampedFields,
  );

  return handleSafe(async () => {
    const executor = new JSVMPSymbolicExecutor();
    const result = await cpuLimit(() =>
      executor.executeJSVMP({
        instructions:
          instructions as import('@modules/symbolic/JSVMPSymbolicExecutor').JSVMPInstruction[],
        ...(vmType ? { vmType } : {}),
        ...(maxSteps !== undefined ? { maxSteps } : {}),
        ...(timeout !== undefined ? { timeout } : {}),
      }),
    );
    return {
      ...(result as unknown as Record<string, unknown>),
      ...(clampedFields.length > 0 ? { clamped: true } : {}),
    };
  });
}
