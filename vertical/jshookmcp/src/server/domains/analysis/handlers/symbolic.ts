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
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import { SymbolicExecutor } from '@modules/symbolic/SymbolicExecutor';
import { JSVMPSymbolicExecutor } from '@modules/symbolic/JSVMPSymbolicExecutor';

export async function handleJsSymbolicExecute(args: ToolArgs): Promise<ToolResponse> {
  const code = argStringRequired(args, 'code');
  if (!code) return asJsonResponse({ success: false, error: 'code is required' });

  const maxPaths = argNumber(args, 'maxPaths');
  const maxDepth = argNumber(args, 'maxDepth');
  const timeout = argNumber(args, 'timeout');
  const enableConstraintSolving = argBool(args, 'enableConstraintSolving', false);

  return handleSafe(async () => {
    const executor = new SymbolicExecutor();
    const result = await executor.execute({
      code,
      ...(maxPaths !== undefined ? { maxPaths } : {}),
      ...(maxDepth !== undefined ? { maxDepth } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
      enableConstraintSolving,
    });
    return result as unknown as Record<string, unknown>;
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
  const maxSteps = argNumber(args, 'maxSteps');
  const timeout = argNumber(args, 'timeout');

  return handleSafe(async () => {
    const executor = new JSVMPSymbolicExecutor();
    const result = await executor.executeJSVMP({
      instructions:
        instructions as import('@modules/symbolic/JSVMPSymbolicExecutor').JSVMPInstruction[],
      ...(vmType ? { vmType } : {}),
      ...(maxSteps !== undefined ? { maxSteps } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    });
    return result as unknown as Record<string, unknown>;
  });
}
