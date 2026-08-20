/**
 * Deobfuscation handlers: deobfuscate, webcrack_unpack, analysis_decode_string_array
 */

import { logger } from '@utils/logger';
import { argBool, argEnum, argNumber, argString } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { AdvancedDeobfuscator, Deobfuscator } from '@server/domains/shared/modules';
import type { ToolArgs, ToolResponse } from '@server/types';
import type { DeobfuscateMappingRule } from '@internal-types/deobfuscator';
import { derotateStringArray } from '@modules/deobfuscator/AdvancedDeobfuscator.ast';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';
import { UniversalUnpacker } from '@modules/deobfuscator/PackerDeobfuscator';
import { VMDeobfuscator } from '@modules/deobfuscator/VMDeobfuscator';
import { parseCode, traverseAst, generateCode, t } from '../shared/ast-utils';
import type { NodePath } from '@babel/traverse';

function requireCodeArg(args: ToolArgs, toolName: string): string | null {
  const code = args.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    logger.warn(`${toolName} called without valid code argument`);
    return null;
  }
  return code;
}

function extractWebcrackArgs(args: ToolArgs) {
  const extracted: Record<string, unknown> = {};

  const unpack = argBool(args, 'unpack');
  const unminify = argBool(args, 'unminify');
  const jsx = argBool(args, 'jsx');
  const mangle = argBool(args, 'mangle');
  const forceOutput = argBool(args, 'forceOutput');
  const includeModuleCode = argBool(args, 'includeModuleCode');
  const outputDir = argString(args, 'outputDir');
  const maxBundleModules = argNumber(args, 'maxBundleModules');

  if (unpack !== undefined) extracted.unpack = unpack;
  if (unminify !== undefined) extracted.unminify = unminify;
  if (jsx !== undefined) extracted.jsx = jsx;
  if (mangle !== undefined) extracted.mangle = mangle;
  if (forceOutput !== undefined) extracted.forceOutput = forceOutput;
  if (includeModuleCode !== undefined) extracted.includeModuleCode = includeModuleCode;
  if (outputDir?.trim()) extracted.outputDir = outputDir;
  if (maxBundleModules !== undefined) extracted.maxBundleModules = maxBundleModules;

  if (Array.isArray(args.mappings)) {
    extracted.mappings = (args.mappings as unknown[]).filter(
      (item): item is DeobfuscateMappingRule =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { path?: unknown }).path === 'string' &&
        typeof (item as { pattern?: unknown }).pattern === 'string',
    );
  }

  return extracted;
}

export async function handleDeobfuscate(
  args: ToolArgs,
  deobfuscator: Deobfuscator,
  advancedDeobfuscator: AdvancedDeobfuscator,
  jscramblerDeobfuscator: JScramberDeobfuscator,
  packerDeobfuscator: UniversalUnpacker,
  vmDeobfuscator: VMDeobfuscator,
): Promise<ToolResponse> {
  const code = requireCodeArg(args, 'deobfuscate');
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  const engine = argEnum(
    args,
    'engine',
    new Set(['auto', 'webcrack', 'jscrambler', 'packer', 'vm'] as const),
    'auto',
  );

  // jscrambler engine
  if (engine === 'jscrambler') {
    const result = await jscramblerDeobfuscator.deobfuscate({ code });
    return asJsonResponse(result);
  }

  // packer engine (UniversalUnpacker auto-detects Dean Edwards/AAEncode/URLEncode)
  if (engine === 'packer') {
    const result = await packerDeobfuscator.deobfuscate(code);
    return asJsonResponse(result);
  }

  // vm engine
  if (engine === 'vm') {
    const detection = vmDeobfuscator.detectVMProtection(code);
    if (!detection.detected) {
      return asJsonResponse({
        success: false,
        error: 'No VM protection detected in the provided code',
        detection,
      });
    }
    const result = await vmDeobfuscator.deobfuscateVM(code, {
      type: detection.type,
      instructionCount: detection.instructionCount,
    });
    return asJsonResponse({ ...result, detection });
  }

  // webcrack engine = former advanced_deobfuscate path
  if (engine === 'webcrack') {
    const result = await advancedDeobfuscator.deobfuscate({
      code,
      ...extractWebcrackArgs(args),
      ...(typeof args.detectOnly === 'boolean' ? { detectOnly: args.detectOnly } : {}),
    });
    return asJsonResponse(result);
  }

  // auto engine = former deobfuscate path
  const result = await deobfuscator.deobfuscate({
    code,
    ...extractWebcrackArgs(args),
  });

  // Ensure failures always carry an error field for LLM clarity
  if (
    result &&
    typeof result === 'object' &&
    'success' in result &&
    result.success === false &&
    !('error' in result)
  ) {
    return asJsonResponse({
      ...result,
      error: (result as Record<string, unknown>).reason || 'deobfuscation failed',
    });
  }

  return asJsonResponse(result);
}

export async function handleWebcrackUnpack(args: ToolArgs): Promise<ToolResponse> {
  const code = requireCodeArg(args, 'webcrack_unpack');
  if (!code) {
    return asJsonResponse({
      success: false,
      error: 'code is required and must be a non-empty string',
    });
  }

  const result = await runWebcrack(code, {
    unpack: argBool(args, 'unpack', true),
    unminify: argBool(args, 'unminify', true),
    jsx: argBool(args, 'jsx', true),
    mangle: argBool(args, 'mangle', false),
    ...extractWebcrackArgs(args),
  });

  if (!result.applied) {
    return asJsonResponse({
      success: false,
      error: result.reason || 'webcrack execution failed',
      optionsUsed: result.optionsUsed,
      engine: 'webcrack',
    });
  }

  return asJsonResponse({
    success: true,
    code: result.code,
    bundle: result.bundle,
    savedTo: result.savedTo,
    savedArtifacts: result.savedArtifacts,
    optionsUsed: result.optionsUsed,
    engine: 'webcrack',
  });
}

export async function handleAnalysisDecodeStringArray(args: ToolArgs): Promise<ToolResponse> {
  const code = argString(args, 'code');
  if (!code) {
    return asJsonResponse({ success: false, error: 'code is required' });
  }

  const maxReplacements = argNumber(args, 'maxReplacements', 200);
  const removeRotation = argBool(args, 'removeRotation', true);
  const preparedCode = removeRotation ? derotateStringArray(code) : code;

  const stringArrays = new Map<string, string[]>();
  let ast: ReturnType<typeof parseCode>;
  try {
    ast = parseCode(preparedCode, { plugins: ['jsx', 'typescript'] });
  } catch (err) {
    return asJsonResponse({
      success: false,
      error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  traverseAst(ast, {
    VariableDeclarator(path: NodePath) {
      if (!path.isVariableDeclarator()) return;
      const node = path.node;
      if (!t.isIdentifier(node.id) || !t.isArrayExpression(node.init)) return;
      const items: string[] = [];
      for (const element of node.init.elements) {
        if (!t.isStringLiteral(element)) return;
        items.push(element.value);
      }
      stringArrays.set(node.id.name, items);
    },
  });

  const replacements: Array<{
    arrayName: string;
    index: number;
    value: string;
    original: string;
  }> = [];
  let replacedCount = 0;

  traverseAst(ast, {
    CallExpression(path: NodePath) {
      if (replacedCount >= maxReplacements) {
        path.stop();
        return;
      }
      if (!path.isCallExpression()) return;
      const node = path.node;
      if (!t.isIdentifier(node.callee)) return;
      const arrayName = node.callee.name;
      const items = stringArrays.get(arrayName);
      if (!items || node.arguments.length !== 1) return;
      const firstArg = node.arguments[0];
      if (!t.isNumericLiteral(firstArg) && !t.isStringLiteral(firstArg)) {
        return;
      }

      const index = t.isNumericLiteral(firstArg)
        ? firstArg.value
        : firstArg.value.startsWith('0x')
          ? Number.parseInt(firstArg.value, 16)
          : Number(firstArg.value);
      if (!Number.isInteger(index) || index < 0 || index >= items.length) return;

      const value = items[index];
      if (typeof value !== 'string') return;

      // Extract original code from source using node positions
      const originalCode = code.slice(node.start ?? 0, node.end ?? 0);

      replacements.push({
        arrayName,
        index,
        value,
        original: originalCode,
      });
      path.replaceWith(t.stringLiteral(value));
      replacedCount += 1;
    },
  });

  return asJsonResponse({
    success: true,
    code: generateCode(ast, { retainLines: true }),
    replacedCount,
    arraysFound: stringArrays.size,
    rotationRemoved: removeRotation && preparedCode !== code,
    replacements,
  });
}
