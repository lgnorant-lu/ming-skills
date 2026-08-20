import * as parser from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { replaceOutsideProtectedRanges } from './ast-safe-replace';

const NUMERIC_BINARY_EXPR = /\b(-?\d+(?:\.\d+)?)\s*([+\-%*/])\s*(-?\d+(?:\.\d+)?)\b/g;
const DEAD_CODE_IF_FALSE = /if\s*\(\s*false\s*\)\s*\{[^}]*\}\s*/g;
const DEAD_CODE_IF_FALSE_WITH_ELSE = /if\s*\(\s*false\s*\)\s*\{[^}]*\}\s*else\s*\{([^}]*)\}/g;
const DEAD_CODE_IF_TRUE = /if\s*\(\s*true\s*\)\s*\{([^}]*)\}\s*(?:else\s*\{[^}]*\}\s*)?/g;
const CFF_PATTERN =
  /var\s+([A-Za-z_$]\w*)\s*=\s*['"]([^'"]+)['"]\.split\(['"]\|['"]\)\s*;\s*var\s+(\w+)\s*=\s*0\s*;\s*while\s*\(\s*!!\[\]\s*\)\s*\{\s*switch\s*\(\s*\1\[\s*\3\+\+\s*\]\s*\)\s*\{([\s\S]*?)\}\s*break;\s*\}/g;
const CFF_PATTERN_VAR2 =
  /var\s+([A-Za-z_$]\w*)\s*=\s*\[(['"][^'"]*['"]\s*(?:,\s*['"][^'"]*['"]\s*)*)\];\s*var\s+(\w+)\s*=\s*(\d+);\s*while\s*\(\s*!!\[\]\s*\)\s*\{\s*switch\s*\(\s*\1\[\s*\3\+\+\]\s*\)\s*\{([\s\S]*?)\}\s*break;\s*\}/g;
const STRING_CONCAT = /['"]([^'"]*)['"]\s*\+\s*['"]([^'"]*)['"]/g;

interface TextReplacement {
  start: number;
  end: number;
  text: string;
}

function findNonWhitespace(input: string, start: number, step: -1 | 1): string {
  for (let index = start; index >= 0 && index < input.length; index += step) {
    const char = input[index];
    if (char && !/\s/.test(char)) {
      return char;
    }
  }
  return '';
}

function applyTextReplacements(code: string, replacements: TextReplacement[]): string {
  const sorted = replacements.toSorted((a, b) => b.start - a.start || b.end - a.end);
  let next = code;
  for (const replacement of sorted) {
    next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`;
  }
  return next;
}

function getBindingReplacement(
  path: NodePath<t.Identifier>,
  renameMap: Map<string, string>,
): string | null {
  const replacement = renameMap.get(path.node.name);
  if (!replacement) {
    return null;
  }

  const binding = path.scope.getBinding(path.node.name);
  if (
    !binding ||
    !t.isVariableDeclarator(binding.path.node) ||
    !t.isIdentifier(binding.path.node.id) ||
    !renameMap.has(binding.path.node.id.name)
  ) {
    return null;
  }

  const isBindingId = binding.identifier === path.node;
  const isReference = path.isReferencedIdentifier();
  const isAssignmentTarget = path.key === 'left' && path.parentPath.isAssignmentExpression();
  const isForLoopTarget =
    path.key === 'left' &&
    (path.parentPath.isForInStatement() || path.parentPath.isForOfStatement());
  const isUpdateTarget = path.key === 'argument' && path.parentPath.isUpdateExpression();

  if (!isBindingId && !isReference && !isAssignmentTarget && !isForLoopTarget && !isUpdateTarget) {
    return null;
  }

  return replacement;
}

function applyRenameVarsWithAst(code: string, renameMap: Map<string, string>): string | null {
  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
    const replacements = new Map<string, TextReplacement>();

    traverse(ast, {
      ObjectProperty(path) {
        if (
          !path.node.shorthand ||
          !t.isIdentifier(path.node.key) ||
          !t.isIdentifier(path.node.value)
        ) {
          return;
        }

        const valuePath = path.get('value');
        if (!valuePath.isIdentifier()) {
          return;
        }

        const replacement = getBindingReplacement(valuePath, renameMap);
        const { start, end } = path.node;
        if (!replacement || start === null || start === undefined) {
          return;
        }
        if (end === null || end === undefined) {
          return;
        }

        replacements.set(`${start}:${end}`, {
          start,
          end,
          text: `${path.node.key.name}: ${replacement}`,
        });
        path.skip();
      },
      Identifier(path) {
        const replacement = getBindingReplacement(path, renameMap);
        const { start, end } = path.node;
        if (!replacement || start === null || start === undefined) {
          return;
        }
        if (end === null || end === undefined) {
          return;
        }

        replacements.set(`${start}:${end}`, {
          start,
          end,
          text: replacement,
        });
      },
    });

    if (replacements.size === 0) {
      return code;
    }
    return applyTextReplacements(code, [...replacements.values()]);
  } catch {
    return null;
  }
}

export function applyConstantFold(code: string): string {
  let result = code;

  result = replaceOutsideProtectedRanges(
    result,
    NUMERIC_BINARY_EXPR,
    (_full, leftRaw: string, op: string, rightRaw: string) => {
      const left = Number(leftRaw);
      const right = Number(rightRaw);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return _full;
      }

      let value: number | null = null;
      if (op === '+') {
        value = left + right;
      } else if (op === '-') {
        value = left - right;
      } else if (op === '*') {
        value = left * right;
      } else if (op === '/' && right !== 0) {
        value = left / right;
      } else if (op === '%' && right !== 0) {
        value = left % right;
      }

      if (value === null || !Number.isFinite(value)) {
        return _full;
      }
      return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12)));
    },
  );

  result = replaceOutsideProtectedRanges(
    result,
    STRING_CONCAT,
    (_full, left: string, right: string) => JSON.stringify(`${left}${right}`),
  );

  const unaryNegDouble = /--(\d)/g;
  result = replaceOutsideProtectedRanges(result, unaryNegDouble, (_full, digit: string) => digit);

  const unaryPlusNumber = /\+\s*(\d+(?:\.\d+)?)/g;
  result = replaceOutsideProtectedRanges(result, unaryPlusNumber, (_full, num: string) => num);

  const hexPattern = /\b0x([0-9a-fA-F]{2,8})\b/g;
  result = replaceOutsideProtectedRanges(result, hexPattern, (_full, hex: string) => {
    const value = Number.parseInt(hex, 16);
    return Number.isFinite(value) ? String(value) : _full;
  });

  return result;
}

export function applyDeadCodeRemove(code: string): string {
  let result = code;

  result = replaceOutsideProtectedRanges(
    result,
    DEAD_CODE_IF_FALSE_WITH_ELSE,
    (_full, elseBody: string) => elseBody,
  );

  result = replaceOutsideProtectedRanges(result, DEAD_CODE_IF_FALSE, '');

  result = replaceOutsideProtectedRanges(
    result,
    DEAD_CODE_IF_TRUE,
    (_full, trueBody: string) => trueBody,
  );

  result = replaceOutsideProtectedRanges(
    result,
    /\btrue\s*\?\s*([^:]+)\s*:\s*([^,;)\]}]+)/g,
    (_full, ifVal: string) => ifVal,
  );
  result = replaceOutsideProtectedRanges(
    result,
    /\bfalse\s*\?\s*[^:]+\s*:\s*([^,;)}\]]+)/g,
    (_full, elseVal: string) => elseVal,
  );

  result = replaceOutsideProtectedRanges(result, /if\s*\([^)]*\)\s*\{\s*\}\s*/g, '');
  return result;
}

export function applyControlFlowFlatten(code: string): string {
  let result = code;

  result = replaceOutsideProtectedRanges(
    result,
    CFF_PATTERN,
    (_full, _dispatcher: string, orderRaw: string, _cursor: string, switchBody: string) => {
      const caseRegex = /case\s*['"]([^'"]+)['"]\s*:\s*([\s\S]*?)(?=case\s*['"]|default\s*:|$)/g;
      const caseMap = new Map<string, string>();
      let match: RegExpExecArray | null;
      while ((match = caseRegex.exec(switchBody)) !== null) {
        const key = match[1];
        const body = (match[2] ?? '')
          .replace(/\bcontinue\s*;?/g, '')
          .replace(/\bbreak\s*;?/g, '')
          .trim();
        if (key && body.length > 0) {
          caseMap.set(key, body);
        }
      }
      const order = orderRaw.split('|').map((value) => value.trim());
      const rebuilt = order
        .map((token) => caseMap.get(token))
        .filter((value): value is string => !!value)
        .join('\n');
      return rebuilt.length > 0 ? rebuilt : _full;
    },
  );

  result = replaceOutsideProtectedRanges(
    result,
    CFF_PATTERN_VAR2,
    (
      _full,
      _dispatcher: string,
      arrContent: string,
      _cursor: string,
      _startIdx: string,
      switchBody: string,
    ) => {
      const caseRegex = /case\s*['"]([^'"]+)['"]\s*:\s*([\s\S]*?)(?=case\s*['"]|default\s*:|$)/g;
      const caseMap = new Map<string, string>();
      let match: RegExpExecArray | null;
      while ((match = caseRegex.exec(switchBody)) !== null) {
        const key = match[1];
        const body = (match[2] ?? '')
          .replace(/\bcontinue\s*;?/g, '')
          .replace(/\bbreak\s*;?/g, '')
          .trim();
        if (key && body.length > 0) {
          caseMap.set(key, body);
        }
      }
      const order = arrContent
        .split(/,\s*/)
        .map((value) => value.replace(/^['"]|['"]$/g, '').trim());
      const rebuilt = order
        .map((token) => caseMap.get(token))
        .filter((value): value is string => !!value)
        .join('\n');
      return rebuilt.length > 0 ? rebuilt : _full;
    },
  );

  return result;
}

export function applyRenameVars(code: string): { code: string; count: number } {
  const declared = new Set<string>();
  const re = /\b(?:var|let|const)\s+([A-Za-z_$]\w{0,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const name = match[1];
    if (name && (name.length <= 2 || name.startsWith('_0x') || name.startsWith('_'))) {
      declared.add(name);
    }
  }
  if (declared.size === 0) {
    return { code, count: 0 };
  }

  const renameMap = new Map<string, string>();
  let counter = 1;
  for (const name of declared) {
    renameMap.set(name, `var_${counter}`);
    counter++;
  }

  const astRenamed = applyRenameVarsWithAst(code, renameMap);
  if (astRenamed !== null) {
    return {
      code: astRenamed,
      count: astRenamed === code ? 0 : renameMap.size,
    };
  }

  const newCode = code.replace(
    new RegExp(
      `\\b(${[...declared].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
      'g',
    ),
    (token, id, offset, full) => {
      const replacement = renameMap.get(id);
      if (!replacement) {
        return token;
      }

      const prev = offset > 0 ? full[offset - 1] : '';
      const prevNonWhitespace = findNonWhitespace(full, offset - 1, -1);
      const nextNonWhitespace = findNonWhitespace(full, offset + token.length, 1);

      if (prev === '.' || prev === "'" || prev === '"' || prev === '`' || prev === '$') {
        return token;
      }
      if (
        (prevNonWhitespace === '{' || prevNonWhitespace === ',') &&
        (nextNonWhitespace === ':' || nextNonWhitespace === '(')
      ) {
        return token;
      }
      return replacement;
    },
  );

  return { code: newCode, count: newCode === code ? 0 : renameMap.size };
}
