/**
 * WAT block-level instrumentation primitives for `wasm_instrument_block`.
 *
 * Pure functions — no I/O, no ExternalToolRunner. Reuses `splitTopLevelNodes`
 * from `./wat-diff` to walk the module, then inserts a
 * `call $__jshook_trace_block (i32.const <ordinal>)` at the entry of every
 * `block` / `loop` / `if` body (and optionally at function entry), plus
 * injects the matching imported trace function.
 *
 * Honest boundary: block/loop/if-ENTRY-level tracing. Within each structured
 * control-flow construct the body instructions between nested blocks are not
 * individually observed — only that execution entered the block.  `br` /
 * `br_if` / `br_table` destinations are covered because branch targets are
 * always block/loop/if labels (explicit or depth-resolved).
 */

import { splitTopLevelNodes } from './wat-diff';

export interface InstrumentBlockOptions {
  /** Imported trace function name (default `$__jshook_trace_block`). */
  traceFnName?: string;
  /** Import module / field (default `__jshook` / `trace_block`). */
  importModule?: string;
  importField?: string;
  /** Also insert a function-entry trace call (ordinal 0 per function). Default true. */
  includeFuncEntry?: boolean;
}

export interface InstrumentBlockResult {
  instrumented: string;
  functionsInstrumented: number;
  blocksInstrumented: number;
  functionsSkipped: number;
}

export interface BasicBlockAnalysis {
  functions: number;
  /** Total block/loop/if structured-control entries found. */
  blocks: number;
  /** Total branch instructions (br / br_if / br_table). */
  branches: number;
  /** Instrumentable block count (blocks + function entries if funcEntry mode). */
  instrumentableBlocks: number;
}

const FUNC_RE = /^\s*\(func\b/;
const FUNC_ATTR_RE = /^\(\s*(?:type|param|result|local|export)\b/;

/**
 * Skip past attributes that can appear before a function / block body.
 * - `$identifier` — block or function name
 * - `(result <type>)` / `(type <index>)` — type specifiers
 * - `(param <type>)` — func-only but harmless to skip on blocks
 * - `(local <type>)` — func-only
 * - `(export "...")` — func-only
 * Returns the index of the first non-attribute token.
 */
function skipAttributes(text: string, pos: number): number {
  const len = text.length;
  while (pos < len) {
    // Whitespace
    while (pos < len && /\s/.test(text.charAt(pos))) pos++;
    if (pos >= len) break;

    const ch = text.charAt(pos);
    if (ch === '$') {
      // $identifier
      while (pos < len && !/[\s()]/.test(text.charAt(pos))) pos++;
    } else if (ch === '(' && FUNC_ATTR_RE.test(text.slice(pos))) {
      // Balanced attribute sub-node
      let depth = 0;
      while (pos < len) {
        const c = text.charAt(pos);
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) {
            pos++;
            break;
          }
        }
        pos++;
      }
    } else {
      break;
    }
  }
  return pos;
}

/**
 * Find body-start offsets for every `(block` / `(loop` / `(if` within a
 * function node body.  The offset points to the first non-attribute token after
 * the keyword — exactly where a trace call should be inserted.
 *
 * Comments (`;;` and `(; … ;)`) and string literals are skipped so parens
 * inside them don't corrupt the scan.
 */
export function findBlockEntryOffsets(funcBody: string): number[] {
  const offsets: number[] = [];
  const len = funcBody.length;
  let i = 0;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(funcBody.charAt(i))) i++;
    if (i >= len) break;

    const ch = funcBody.charAt(i);

    // Line comment
    if (ch === ';' && funcBody.charAt(i + 1) === ';') {
      const nl = funcBody.indexOf('\n', i);
      i = nl < 0 ? len : nl + 1;
      continue;
    }

    // Block comment (; ... ;)
    if (ch === '(' && funcBody.charAt(i + 1) === ';') {
      i += 2;
      while (i < len - 1 && !(funcBody.charAt(i) === ';' && funcBody.charAt(i + 1) === ')')) i++;
      i += 2;
      continue;
    }

    // String literal
    if (ch === '"') {
      i++;
      while (i < len) {
        if (funcBody.charAt(i) === '\\') {
          i++;
        } else if (funcBody.charAt(i) === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '(') {
      const restStart = i + 1;
      const m = funcBody.slice(restStart).match(/^\s*(block|loop|if)\b/);
      if (m) {
        const afterKw = restStart + m[0].length;
        const bodyStart = skipAttributes(funcBody, afterKw);
        offsets.push(bodyStart);
      }
    }

    i++;
  }

  return offsets;
}

/**
 * Count branch instructions in WAT text (for diagnostic analysis).
 * Matches `(br …)`, `br …` (unfolded), `(br_if …)`, `br_if …`, and `br_table` variants.
 */
export function countBranches(text: string): number {
  // Match both parenthesized and bare branch forms
  const re = /\(?\s*br(?:_if|_table)?\b/g;
  let count = 0;
  while (re.exec(text) !== null) count++;
  return count;
}

/**
 * Insert trace calls (back-to-front so earlier offsets stay valid) into
 * a function body.  Returns the modified body and the number of calls inserted.
 */
function insertTraces(
  funcBody: string,
  offsets: number[],
  startOrdinal: number,
  traceFn: string,
): { text: string; count: number } {
  if (offsets.length === 0) return { text: funcBody, count: 0 };

  // Sort descending so we never invalidate later offsets
  const sorted = offsets.toSorted((a, b) => b - a);
  let result = funcBody;
  let ordinal = startOrdinal;

  for (const pos of sorted) {
    const call = `(call ${traceFn} (i32.const ${ordinal})) `;
    result = result.slice(0, pos) + call + result.slice(pos);
    ordinal++;
  }

  return { text: result, count: sorted.length };
}

/** Shift numeric references in the function index space after prepending an import. */
function shiftNumericFunctionIndices(watNode: string): string {
  let shifted = watNode.replace(
    /(\(elem\b[\s\S]*?\bfunc\s+)(\d+(?:\s+\d+)*)(?=\s*\))/g,
    (_match, prefix, indices) => {
      const rewritten = String(indices).replace(/\d+/g, (index) => String(Number(index) + 1));
      return `${prefix}${rewritten}`;
    },
  );
  shifted = shifted.replace(
    /(\b(?:call|ref\.func)\s+)(\d+)\b/g,
    (_match, prefix, index) => `${prefix}${Number(index) + 1}`,
  );
  shifted = shifted.replace(
    /(\((?:func|start)\s+)(\d+)\b/g,
    (_match, prefix, index) => `${prefix}${Number(index) + 1}`,
  );
  return shifted;
}

/**
 * Instrument every function body with block-entry trace calls.
 *
 * Each function gets:
 * - (optional) function-entry trace at ordinal `funcBase`
 * - A block-entry trace at every `block` / `loop` / `if` body entry
 *
 * Global ordinals are assigned sequentially within the module.
 * The trace import `(import mod field (func traceFn (param i32)))` is injected.
 */
export function instrumentWatBlocks(
  wat: string,
  options?: InstrumentBlockOptions,
): InstrumentBlockResult {
  const traceFn = options?.traceFnName ?? '$__jshook_trace_block';
  const mod = options?.importModule ?? '__jshook';
  const field = options?.importField ?? 'trace_block';
  const includeFuncEntry = options?.includeFuncEntry ?? true;

  const nodes = splitTopLevelNodes(wat);
  const importNode = `(import "${mod}" "${field}" (func ${traceFn} (param i32)))`;

  let globalOrdinal = 0;
  let totalBlocks = 0;
  let functionsInstrumented = 0;
  let functionsSkipped = 0;
  const outNodes: string[] = [importNode];

  for (const node of nodes) {
    const shiftedNode = shiftNumericFunctionIndices(node);
    if (!FUNC_RE.test(node)) {
      outNodes.push(shiftedNode);
      continue;
    }

    try {
      // 1. Find function body start (for optional func-entry trace).
      const funcMarker = '(func';
      const funcIdx = shiftedNode.indexOf(funcMarker);
      const bodyStart = skipAttributes(shiftedNode, funcIdx + funcMarker.length);

      // 2. Instrument with block-entry traces (and optional func-entry trace).
      const blockOffsets = findBlockEntryOffsets(shiftedNode);

      // 3. If func-entry is wanted, prepend it — it uses ordinal 0 for this
      //    function (or the next global ordinal).
      let offsets = blockOffsets;
      if (includeFuncEntry) {
        offsets = [bodyStart, ...blockOffsets];
      }

      const { text, count } = insertTraces(shiftedNode, offsets, globalOrdinal, traceFn);
      globalOrdinal += count;
      totalBlocks += blockOffsets.length;
      outNodes.push(text);
      functionsInstrumented++;
    } catch {
      outNodes.push(shiftedNode);
      functionsSkipped++;
    }
  }

  // Reassemble: splice instrumented nodes back inside the (module ...) wrapper.
  const moduleStart = wat.indexOf('(module');
  const closeParen = wat.lastIndexOf(')');
  const prefix = wat.slice(0, moduleStart + '(module'.length);
  const suffix = wat.slice(closeParen);

  const instrumented = `${prefix}\n  ${outNodes.join('\n')}\n${suffix}`;
  return { instrumented, functionsInstrumented, blocksInstrumented: totalBlocks, functionsSkipped };
}

/**
 * Diagnostic: count functions, blocks, branches, and instrumentable targets
 * in a WAT module.  Useful for estimating instrumentation density before
 * applying it.
 */
export function analyzeWasmBasicBlocks(watText: string): BasicBlockAnalysis {
  const nodes = splitTopLevelNodes(watText);
  let functions = 0;
  let blocks = 0;
  let branches = 0;

  for (const node of nodes) {
    if (!FUNC_RE.test(node)) continue;
    functions++;

    // Count block/loop/if entries
    blocks += findBlockEntryOffsets(node).length;

    // Count branch instructions
    branches += countBranches(node);
  }

  const instrumentableBlocks = blocks + functions; // func entries + block entries
  return { functions, blocks, branches, instrumentableBlocks };
}
