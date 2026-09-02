/**
 * Shared condition expression validator and evaluator for breakpoints.
 *
 * The debugger domain uses `@babel/parser` parseExpression for pre-validation
 * of CDP breakpoint conditions (which V8 evaluates serverside). For Win32
 * software/hardware breakpoints we need local evaluation — this module provides
 * both validation (shared with debugger domain pattern) and evaluation.
 *
 * @module ConditionEvaluator
 */

import { parseExpression } from '@babel/parser';

const MAX_CONDITION_LENGTH = 50_000;

/** Register name aliases — both x86-32 and x64 names are accepted. */
const REGISTER_ALIASES: Record<string, string> = {
  // x64 → x64
  rax: 'rax',
  rbx: 'rbx',
  rcx: 'rcx',
  rdx: 'rdx',
  rsi: 'rsi',
  rdi: 'rdi',
  rsp: 'rsp',
  rbp: 'rbp',
  r8: 'r8',
  r9: 'r9',
  r10: 'r10',
  r11: 'r11',
  r12: 'r12',
  r13: 'r13',
  r14: 'r14',
  r15: 'r15',
  rip: 'rip',
  eip: 'rip',
  rflags: 'rflags',
  eflags: 'rflags',
  // x86-32 → x64 (low 32 bits mapped to full register)
  eax: 'rax',
  ebx: 'rbx',
  ecx: 'rcx',
  edx: 'rdx',
  esi: 'rsi',
  edi: 'rdi',
  esp: 'rsp',
  ebp: 'rbp',
};

export interface ConditionContext {
  /** Register values as BigInt strings (hex). The expression is string-evaluated
   *  for safety — BigInt comparison in eval'd JS requires BigInt literals. */
  registers: Record<string, string>;
}

/**
 * Pre-validate a breakpoint condition expression using @babel/parser.
 * This follows the same pattern as the debugger domain's
 * `validateBreakpointCondition` in `breakpoint-basic.ts`.
 *
 * @throws {Error} with a descriptive message if the expression is invalid
 */
export function validateBreakpointCondition(condition: string | undefined): void {
  if (condition === undefined || condition.trim() === '') return;
  if (condition.length > MAX_CONDITION_LENGTH) {
    throw new Error(
      `Invalid breakpoint condition: condition is too long (max ${MAX_CONDITION_LENGTH} chars)`,
    );
  }

  try {
    parseExpression(condition, {
      sourceType: 'unambiguous',
      errorRecovery: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid breakpoint condition: ${message}`, { cause: error });
  }
}

/**
 * Evaluate a breakpoint condition expression against register values.
 *
 * Accepts both x86-32 register names (eax, ecx, ...) and x64 names (rax, rcx, ...).
 * Register values are BigInt hex strings — they are converted to BigInt for
 * comparison operations within the expression.
 *
 * @param condition — JavaScript expression string (e.g. "rax > 0x1000 && ecx == 5")
 * @param ctx — register values as hex strings
 * @returns true if condition passes (or no condition set), false otherwise
 */
export function evaluateBreakpointCondition(
  condition: string | undefined,
  ctx: ConditionContext,
): boolean {
  if (!condition || condition.trim() === '') return true;

  // Map register alias names to actual values, converting hex strings to BigInt
  const resolved: Record<string, bigint> = {};
  for (const [alias, target] of Object.entries(REGISTER_ALIASES)) {
    const hexValue = ctx.registers[target];
    if (hexValue !== undefined) {
      try {
        resolved[alias] = BigInt(hexValue);
      } catch {
        resolved[alias] = 0n;
      }
    }
  }

  // Build parameter list from all register names that appear in the expression.
  // We include all known register names so users can reference any register.
  const paramNames = Object.keys(resolved);
  const paramValues = paramNames.map((n) => resolved[n]!);

  try {
    const fn = new Function(...paramNames, `return (${condition});`);
    const result = fn(...paramValues);
    return Boolean(result);
  } catch {
    // If evaluation fails (e.g. referencing an unknown variable), treat as
    // "condition not met" — safer than crashing the debug loop.
    return false;
  }
}

/**
 * Format register values from a parsed x64 context into the shape
 * expected by ConditionEvaluator.
 */
export function buildConditionContext(regs: Record<string, string>): ConditionContext {
  return { registers: regs };
}
