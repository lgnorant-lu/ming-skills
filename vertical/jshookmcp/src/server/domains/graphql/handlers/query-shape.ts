/**
 * GraphQL query shape analyzer — pure structural analysis without executing.
 *
 * Walks a GraphQL operation string (no external parser dependency) to report
 * selection depth, per-level breadth, a heuristic cost score, operation type,
 * and fragment-spread cycle detection. Used to enrich extracted queries with
 * shape signal so analysts can spot deep / wide / cyclic DoS-shaped queries
 * (e.g. `user { friends { friends { friends } } }`) without eyeballing raw text.
 *
 * This is a conservative heuristic, not a spec-complete GraphQL parser:
 * - String literals and `#` comments are stripped so their braces never count.
 * - Argument lists `(...)` and list literals `[...]` are skipped wholesale, so
 *   object-literal input values inside args do not inflate depth.
 * - Fields inside `fragment ... on T { ... }` bodies are tracked for cycle
 *   detection but do NOT inflate the operation's breadth (the operation is the
 *   unit being shaped; fragments are expansion units).
 * - Sibling fields are recognized with or without commas (GraphQL allows both).
 */

export type GraphQLOperationType = 'query' | 'mutation' | 'subscription' | 'unknown';

export interface QueryShape {
  operationType: GraphQLOperationType;
  operationName: string | null;
  /** Max selection-set nesting depth of the operation root (0 = no fields). */
  depth: number;
  /** Field count at each depth level of the operation (index 0 = top-level). */
  breadthByLevel: number[];
  maxBreadth: number;
  totalFields: number;
  /** Heuristic cost: Σ breadth[i] × (i + 1) — depth-weighted field pressure. */
  costScore: number;
  fragments: {
    definitions: number;
    spreads: number;
    inline: number;
  };
  /** True iff any fragment-spread graph contains a cycle. */
  hasCycle: boolean;
}

const TOKEN_RE = /\.\.\.|[{}()[\]:,@!|]|[_A-Za-z][_0-9A-Za-z]*|-?\d+(?:\.\d+)?/g;
const OPERATION_KEYWORDS = new Set(['query', 'mutation', 'subscription']);
const IDENT_RE = /^[_A-Za-z][_0-9A-Za-z]*$/;

/** Tokens whose follower identifier is NOT a field (alias target / type / directive / spread name). */
const NON_FIELD_PRIOR = new Set([':', 'on', '@', '...']);

/**
 * Strip `#` line comments and string/block-string literals, replacing each
 * literal with `""` so braces / hashes inside them never affect tokenization.
 */
function stripLiterals(input: string): string {
  let out = '';
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === '#') {
      while (i < n && input[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '"') {
      if (input[i + 1] === '"' && input[i + 2] === '"') {
        i += 3;
        while (i < n) {
          if (input[i] === '"' && input[i + 1] === '"' && input[i + 2] === '"') {
            i += 3;
            break;
          }
          i += 1;
        }
        out += '""';
        continue;
      }
      i += 1;
      while (i < n && input[i] !== '"' && input[i] !== '\n') {
        if (input[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += '""';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function tokenize(stripped: string): string[] {
  TOKEN_RE.lastIndex = 0;
  return stripped.match(TOKEN_RE) ?? [];
}

/**
 * DFS cycle detection over the fragment reference graph. Only back edges
 * (a fragment reachable from itself) count — forward/cross edges are legal.
 */
function detectCycle(fragmentRefs: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const dfs = (name: string): boolean => {
    if (stack.has(name)) return true;
    if (visited.has(name)) return false;
    visited.add(name);
    stack.add(name);
    const refs = fragmentRefs.get(name);
    if (refs) {
      for (const ref of refs) {
        if (fragmentRefs.has(ref) && dfs(ref)) return true;
      }
    }
    stack.delete(name);
    return false;
  };
  for (const name of fragmentRefs.keys()) {
    if (dfs(name)) return true;
  }
  return false;
}

export function analyzeQueryShape(query: string): QueryShape {
  const stripped = stripLiterals(typeof query === 'string' ? query : '');
  const tokens = tokenize(stripped);

  let operationType: GraphQLOperationType = 'unknown';
  let operationName: string | null = null;

  let depth = -1;
  const breadthByLevel: number[] = [];
  let totalFields = 0;

  let parenDepth = 0;
  let bracketDepth = 0;
  let lastToken = '';

  // Fragment bodies are tracked separately: their fields do not inflate the
  // operation breadth, but their spreads feed cycle detection.
  let inFragmentBody = false;
  let currentFragmentName: string | null = null;
  let fragmentDefinitions = 0;
  let spreads = 0;
  let inlineFragments = 0;
  const fragmentRefs = new Map<string, string[]>();

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    if (token === '(') {
      parenDepth += 1;
      lastToken = '(';
      continue;
    }
    if (token === ')') {
      if (parenDepth > 0) parenDepth -= 1;
      lastToken = ')';
      continue;
    }
    if (token === '[') {
      bracketDepth += 1;
      lastToken = '[';
      continue;
    }
    if (token === ']') {
      if (bracketDepth > 0) bracketDepth -= 1;
      lastToken = ']';
      continue;
    }
    if (parenDepth > 0 || bracketDepth > 0) continue;

    if (token === '{') {
      depth += 1;
      if (breadthByLevel[depth] === undefined) breadthByLevel[depth] = 0;
      lastToken = '{';
      continue;
    }
    if (token === '}') {
      if (depth === 0 && inFragmentBody) {
        inFragmentBody = false;
        currentFragmentName = null;
      }
      if (depth >= 0) depth -= 1;
      lastToken = '}';
      continue;
    }
    if (token === ',') {
      lastToken = ',';
      continue;
    }
    if (token === '...') {
      const next = tokens[i + 1];
      if (next === 'on') {
        inlineFragments += 1;
      } else if (next !== undefined && IDENT_RE.test(next)) {
        spreads += 1;
        if (currentFragmentName) {
          const refs = fragmentRefs.get(currentFragmentName) ?? [];
          refs.push(next);
          fragmentRefs.set(currentFragmentName, refs);
        }
      }
      lastToken = '...';
      continue;
    }

    // Operation keyword — GraphQL requires the operation (or shorthand `{`)
    // at the document start, so only the first significant token counts.
    if (i === 0 && OPERATION_KEYWORDS.has(token)) {
      operationType = token as GraphQLOperationType;
      lastToken = token;
      continue;
    }

    // Operation name follows the keyword.
    if (OPERATION_KEYWORDS.has(lastToken) && IDENT_RE.test(token)) {
      operationName = token;
      lastToken = token;
      continue;
    }

    // Fragment definition: `fragment Name on Type { ... }` (may follow the operation).
    if (token === 'fragment' && depth < 0) {
      const next = tokens[i + 1];
      if (next && IDENT_RE.test(next) && next !== 'on') {
        currentFragmentName = next;
        fragmentDefinitions += 1;
        fragmentRefs.set(next, []);
        inFragmentBody = true; // armed; the body brace is consumed next
      }
      lastToken = 'fragment';
      continue;
    }

    if (token === 'on' || token === '@') {
      lastToken = token;
      continue;
    }

    // Field counting — operation body only (fragment bodies feed cycle detection).
    // A follower identifier is a field unless the prior token marks it as an
    // alias target (`:`), a type name (`on`), or a directive (`@`). Sibling
    // fields separated only by whitespace (no comma) are still counted.
    if (depth >= 0 && !inFragmentBody && IDENT_RE.test(token)) {
      if (NON_FIELD_PRIOR.has(lastToken)) {
        lastToken = token;
        continue;
      }
      if (operationType === 'unknown') operationType = 'query'; // shorthand `{ ... }`
      breadthByLevel[depth] = (breadthByLevel[depth] ?? 0) + 1;
      totalFields += 1;
      lastToken = token;
      continue;
    }

    lastToken = token;
  }

  // Trim trailing zero levels left by deep-but-empty fragment bodies.
  let realDepth = breadthByLevel.length;
  while (realDepth > 0 && (breadthByLevel[realDepth - 1] ?? 0) === 0) {
    realDepth -= 1;
  }
  const trimmedBreadth = breadthByLevel.slice(0, realDepth);
  const maxBreadth = trimmedBreadth.reduce((max, b) => (b > max ? b : max), 0);
  const costScore = trimmedBreadth.reduce((sum, b, level) => sum + b * (level + 1), 0);

  return {
    operationType,
    operationName,
    depth: realDepth,
    breadthByLevel: trimmedBreadth,
    maxBreadth,
    totalFields,
    costScore,
    fragments: {
      definitions: fragmentDefinitions,
      spreads,
      inline: inlineFragments,
    },
    hasCycle: detectCycle(fragmentRefs),
  };
}
