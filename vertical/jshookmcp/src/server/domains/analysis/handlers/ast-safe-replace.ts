import * as parser from '@babel/parser';
import traverse from '@babel/traverse';

interface ProtectedRange {
  start: number;
  end: number;
}

type SafeReplaceCallback = (match: string, ...args: any[]) => string;

const REGEX_OPENER_PREV = new Set([
  '=',
  '(',
  '[',
  ',',
  ';',
  '{',
  '!',
  '&',
  '|',
  '?',
  ':',
  '~',
  '^',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '\n',
]);

function cloneRegex(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

function mergeProtectedRanges(ranges: ProtectedRange[]): ProtectedRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const merged: ProtectedRange[] = [];
  const sorted = ranges.toSorted((a, b) => a.start - b.start || a.end - b.end);
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
      continue;
    }
    last.end = Math.max(last.end, range.end);
  }
  return merged;
}

function collectProtectedRangesWithAst(code: string): ProtectedRange[] | null {
  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
    const ranges: ProtectedRange[] = [];
    const pushRange = (start: number | null | undefined, end: number | null | undefined) => {
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        ranges.push({ start, end });
      }
    };

    const comments = Array.isArray(
      (ast as { comments?: Array<{ start?: number; end?: number }> }).comments,
    )
      ? (ast as { comments: Array<{ start?: number; end?: number }> }).comments
      : [];
    for (const comment of comments) {
      pushRange(comment.start, comment.end);
    }

    traverse(ast, {
      StringLiteral(path) {
        pushRange(path.node.start, path.node.end);
        path.skip();
      },
      TemplateElement(path) {
        pushRange(path.node.start, path.node.end);
        path.skip();
      },
      RegExpLiteral(path) {
        pushRange(path.node.start, path.node.end);
        path.skip();
      },
    });

    return mergeProtectedRanges(ranges);
  } catch {
    return null;
  }
}

function getReplaceCallbackOffset(args: unknown[]): number | null {
  const maybeOffset = args[args.length - 2];
  if (typeof maybeOffset === 'number') {
    return maybeOffset;
  }

  const fallbackOffset = args[args.length - 3];
  return typeof fallbackOffset === 'number' ? fallbackOffset : null;
}

function isRegexOpener(code: string, pos: number): boolean {
  let prevIndex = pos - 1;
  while (
    prevIndex >= 0 &&
    (code[prevIndex] === ' ' || code[prevIndex] === '\t' || code[prevIndex] === '\r')
  ) {
    prevIndex--;
  }

  if (prevIndex < 0) {
    return true;
  }

  const prev = code[prevIndex]!;
  if (REGEX_OPENER_PREV.has(prev)) {
    return true;
  }

  if (prev !== ')') {
    return false;
  }

  let depth = 1;
  let keywordIndex = prevIndex - 1;
  while (keywordIndex >= 0 && depth > 0) {
    if (code[keywordIndex] === ')') {
      depth++;
    }
    if (code[keywordIndex] === '(') {
      depth--;
    }
    keywordIndex--;
  }

  keywordIndex--;
  while (keywordIndex >= 0 && (code[keywordIndex] === ' ' || code[keywordIndex] === '\t')) {
    keywordIndex--;
  }

  let keyword = '';
  while (keywordIndex >= 0 && /[a-z]/.test(code[keywordIndex]!)) {
    keyword = code[keywordIndex]! + keyword;
    keywordIndex--;
  }

  return ['if', 'while', 'for', 'switch', 'return', 'typeof', 'void', 'in', 'of', 'case'].includes(
    keyword,
  );
}

function insideStringLiteralOrComment(code: string, offset: number): boolean {
  let inStr: "'" | '"' | '`' | null = null;
  let inBlockComment = false;
  let inLineComment = false;
  let inRegex = false;

  for (let index = 0; index < offset; index++) {
    const char = code[index]!;
    if (inBlockComment) {
      if (char === '*' && code[index + 1] === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }
    if (inRegex) {
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === '/') {
        inRegex = false;
        index++;
        while (index < offset && /[gimsuy]/.test(code[index]!)) {
          index++;
        }
        continue;
      }
      if (char === '[') {
        index++;
        while (index < offset && code[index] !== ']') {
          if (code[index] === '\\') {
            index++;
          }
          index++;
        }
        continue;
      }
      continue;
    }
    if (inStr) {
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === inStr) {
        inStr = null;
      }
      continue;
    }
    if (char === '/' && code[index + 1] === '/') {
      inLineComment = true;
      index++;
      continue;
    }
    if (char === '/' && code[index + 1] === '*') {
      inBlockComment = true;
      index++;
      continue;
    }
    if (char === '/' && isRegexOpener(code, index)) {
      inRegex = true;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      inStr = char;
    }
  }

  return inStr !== null || inBlockComment || inLineComment || inRegex;
}

export function replaceOutsideProtectedRanges(
  code: string,
  pattern: RegExp,
  replacement: string | SafeReplaceCallback,
): string {
  const applyReplacement = (input: string): string =>
    typeof replacement === 'string'
      ? input.replace(cloneRegex(pattern), replacement)
      : input.replace(cloneRegex(pattern), replacement);
  const protectedRanges = collectProtectedRangesWithAst(code);

  if (protectedRanges === null) {
    return code.replace(cloneRegex(pattern), (...args: unknown[]) => {
      const fullMatch = typeof args[0] === 'string' ? args[0] : '';
      const offset = getReplaceCallbackOffset(args);
      if (offset !== null && insideStringLiteralOrComment(code, offset)) {
        return fullMatch;
      }
      return typeof replacement === 'string'
        ? replacement
        : replacement(fullMatch, ...args.slice(1));
    });
  }

  if (protectedRanges.length === 0) {
    return applyReplacement(code);
  }

  let rewritten = '';
  let cursor = 0;
  for (const range of protectedRanges) {
    if (cursor < range.start) {
      rewritten += applyReplacement(code.slice(cursor, range.start));
    }
    rewritten += code.slice(range.start, range.end);
    cursor = range.end;
  }
  if (cursor < code.length) {
    rewritten += applyReplacement(code.slice(cursor));
  }
  return rewritten;
}
