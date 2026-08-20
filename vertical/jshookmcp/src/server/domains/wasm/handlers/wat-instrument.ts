/**
 * WAT instrumentation primitives for `wasm_instrument_binary`.
 *
 * Pure functions — no I/O, no ExternalToolRunner. Reuses `splitTopLevelNodes`
 * from `./wat-diff` (balanced S-expression split that skips string literals)
 * to walk the module, then inserts a `call $__jshook_trace_fn (i32.const <n>)`
 * at the entry of every function body and injects the matching imported
 * trace function.
 *
 * Honest boundary: this is FUNCTION-ENTRY-level tracing, not basic-block-level.
 * Indirect / branch internal dispatch is still not observed per-block — only
 * that a function was entered. `trace_fn` is an imported function the host (or
 * a runtime wrapper) must supply at instantiation. This is real wasm-level
 * instrumentation (the code section is rewritten and reassembled via wat2wasm),
 * in contrast to `wasm_instrument_trace` which only proxies JS-visible exports.
 */

import { splitTopLevelNodes } from './wat-diff';

export interface InstrumentWatOptions {
  /** Imported trace function name (default `$__jshook_trace_fn`). */
  traceFnName?: string;
  /** Import module / field for the trace function (default `__jshook` / `trace_fn`). */
  importModule?: string;
  importField?: string;
}

export interface InstrumentWatResult {
  instrumented: string;
  functionsInstrumented: number;
  functionsSkipped: number;
}

const FUNC_RE = /^\s*\(func\b/;
// Attribute sub-nodes of a function: (type ...), (param ...), (result ...),
// (local ...), (export ...). NOTE: `local` must NOT match `(local.get` /
// `(local.set` — those are body instructions. `\b` would match before the
// `.`, so require whitespace or end-of-node after `local`.
const FUNC_ATTR_RE = /^\(\s*(?:type|param|result|export)\b|^\(\s*local(?:\s|$)/;

/**
 * Insert a `(call $traceFn (i32.const ordinal))` at the entry of a function
 * node's body. Scans past the function attributes (`$name`, type/param/result/
 * local/export sub-nodes) and inserts the call immediately before the first
 * body token. Uses `charAt` so `noUncheckedIndexedAccess` never bites.
 */
function insertCallAtFuncEntry(funcNode: string, ordinal: number, traceFn: string): string {
  const marker = '(func';
  const funcIdx = funcNode.indexOf(marker);
  let pos = funcIdx + marker.length;
  const len = funcNode.length;

  while (pos < len) {
    while (pos < len && /\s/.test(funcNode.charAt(pos))) pos++;
    if (pos >= len) break;
    const ch = funcNode.charAt(pos);
    if (ch === '$') {
      // $identifier attribute — skip the token
      while (pos < len && !/[\s()]/.test(funcNode.charAt(pos))) pos++;
    } else if (ch === '(' && FUNC_ATTR_RE.test(funcNode.slice(pos))) {
      // attribute sub-node (type/param/result/local/export) — skip balanced
      let depth = 0;
      while (pos < len) {
        const c = funcNode.charAt(pos);
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
      // first body token reached — insert the call before it
      break;
    }
  }

  const call = `(call ${traceFn} (i32.const ${ordinal}))`;
  return `${funcNode.slice(0, pos)}\n    ${call}\n  ${funcNode.slice(pos)}`;
}

/**
 * Instrument every function in a WAT module with an entry-trace call, and
 * inject the matching imported trace function. Reassembles the module text;
 * the caller feeds the result to wat2wasm. Each function is tagged with its
 * ordinal index (0-based, in source order) so the host trace_fn can identify it.
 */
export function instrumentWat(wat: string, options?: InstrumentWatOptions): InstrumentWatResult {
  const traceFn = options?.traceFnName ?? '$__jshook_trace_fn';
  const mod = options?.importModule ?? '__jshook';
  const field = options?.importField ?? 'trace_fn';

  const nodes = splitTopLevelNodes(wat);
  const importNode = `(import "${mod}" "${field}" (func ${traceFn} (param i32)))`;

  let ordinal = 0;
  let functionsInstrumented = 0;
  let functionsSkipped = 0;
  const outNodes: string[] = [importNode];

  for (const node of nodes) {
    if (FUNC_RE.test(node)) {
      try {
        outNodes.push(insertCallAtFuncEntry(node, ordinal, traceFn));
        functionsInstrumented++;
      } catch {
        outNodes.push(node);
        functionsSkipped++;
      }
      ordinal++;
    } else {
      outNodes.push(node);
    }
  }

  // Reassemble: splice instrumented nodes back inside the (module ...) wrapper.
  // `slice(0, openParen + 1)` would drop the `module` keyword (leaving a bare
  // `(`), so rebuild the wrapper explicitly.
  const moduleStart = wat.indexOf('(module');
  const closeParen = wat.lastIndexOf(')');
  const prefix = wat.slice(0, moduleStart) + '(module';
  const suffix = wat.slice(closeParen);

  const instrumented = `${prefix}\n  ${outNodes.join('\n')}\n${suffix}`;
  return { instrumented, functionsInstrumented, functionsSkipped };
}
