/**
 * Standalone transform operations extracted from TransformToolHandlersOps.
 */

import type { TransformKind, ApplyResult, TransformChainDefinition } from './shared';
import { TransformLimit, parseTransforms } from './shared';
import { buildLineDiff } from './diff';
import {
  transformConstantFoldAst,
  transformControlFlowFlattenAst,
  transformDeadCodeRemoveAst,
  transformRenameVarsAst,
  transformStringDecryptAst,
} from './ast-ops';

export function resolveTransformsForApply(
  chains: Map<string, TransformChainDefinition>,
  chainName: string,
  transformsRaw: unknown,
): TransformKind[] {
  if (chainName.length > 0) {
    const chain = chains.get(chainName);
    if (!chain) throw new Error(`Transform chain not found: ${chainName}`);
    return [...chain.transforms];
  }
  return parseTransforms(transformsRaw);
}

export function applyTransforms(code: string, transforms: TransformKind[]): ApplyResult {
  let transformed = code;
  const appliedTransforms: TransformKind[] = [];
  for (const transform of transforms) {
    const before = transformed;
    transformed = applySingleTransform(transformed, transform);
    if (transformed !== before) appliedTransforms.push(transform);
  }
  return { transformed, appliedTransforms };
}

function applySingleTransform(code: string, transform: TransformKind): string {
  switch (transform) {
    case 'constant_fold':
      return transformConstantFold(code);
    case 'string_decrypt':
      return transformStringDecrypt(code);
    case 'dead_code_remove':
      return transformDeadCodeRemove(code);
    case 'control_flow_flatten':
      return transformControlFlowFlatten(code);
    case 'rename_vars':
      return transformRenameVars(code);
    default:
      return code;
  }
}

function transformConstantFold(code: string): string {
  return transformConstantFoldAst(code);
}

function transformStringDecrypt(code: string): string {
  return transformStringDecryptAst(code);
}

function transformDeadCodeRemove(code: string): string {
  return transformDeadCodeRemoveAst(code);
}

function transformControlFlowFlatten(code: string): string {
  return transformControlFlowFlattenAst(code);
}

function transformRenameVars(code: string): string {
  return transformRenameVarsAst(code);
}

export function buildDiff(original: string, transformed: string): string {
  return buildLineDiff(original, transformed, {
    maxLcsCells: TransformLimit.MAX_LCS_CELLS,
  });
}
