import type {
  ApplyResult,
  TransformKind,
} from '@server/domains/transform/handlers.impl.transform-base';
import {
  TransformLimit,
  TransformToolHandlersBase,
} from '@server/domains/transform/handlers.impl.transform-base';
import { buildFallbackLineDiff, buildLineDiff } from './handlers/diff';
import {
  transformConstantFoldAst,
  transformControlFlowFlattenAst,
  transformDeadCodeRemoveAst,
  transformRenameVarsAst,
  transformStringDecryptAst,
} from './handlers/ast-ops';

export class TransformToolHandlersOps extends TransformToolHandlersBase {
  protected resolveTransformsForApply(chainName: string, transformsRaw: unknown): TransformKind[] {
    if (chainName.length > 0) {
      const chain = this.chains.get(chainName);
      if (!chain) {
        throw new Error(`Transform chain not found: ${chainName}`);
      }
      return [...chain.transforms];
    }
    return this.parseTransforms(transformsRaw);
  }

  protected applyTransforms(code: string, transforms: TransformKind[]): ApplyResult {
    let transformed = code;
    const appliedTransforms: TransformKind[] = [];

    for (const transform of transforms) {
      const before = transformed;
      transformed = this.applySingleTransform(transformed, transform);
      if (transformed !== before) {
        appliedTransforms.push(transform);
      }
    }

    return { transformed, appliedTransforms };
  }

  protected applySingleTransform(code: string, transform: TransformKind): string {
    switch (transform) {
      case 'constant_fold':
        return this.transformConstantFold(code);
      case 'string_decrypt':
        return this.transformStringDecrypt(code);
      case 'dead_code_remove':
        return this.transformDeadCodeRemove(code);
      case 'control_flow_flatten':
        return this.transformControlFlowFlatten(code);
      case 'rename_vars':
        return this.transformRenameVars(code);
      default:
        return code;
    }
  }

  protected transformConstantFold(code: string): string {
    return transformConstantFoldAst(code);
  }

  protected transformStringDecrypt(code: string): string {
    return transformStringDecryptAst(code);
  }

  protected transformDeadCodeRemove(code: string): string {
    return transformDeadCodeRemoveAst(code);
  }

  protected transformControlFlowFlatten(code: string): string {
    return transformControlFlowFlattenAst(code);
  }

  protected transformRenameVars(code: string): string {
    return transformRenameVarsAst(code);
  }

  protected buildDiff(original: string, transformed: string): string {
    return buildLineDiff(original, transformed, {
      maxLcsCells: TransformLimit.MAX_LCS_CELLS,
      fallback: (oldLines, newLines) => this.buildFallbackDiff(oldLines, newLines),
    });
  }

  protected buildFallbackDiff(oldLines: string[], newLines: string[]): string {
    return buildFallbackLineDiff(oldLines, newLines);
  }
}
