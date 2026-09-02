/**
 * Shared platform utilities — helpers duplicated across breakpoint engines.
 *
 * @module platform/utils
 */

import { ToolError } from '@errors/ToolError';

/** Promise-based sleep used by polling loops in breakpoint engines. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Allocate the next free x86-64 hardware debug register (DR0-DR3).
 *
 * Mutates the caller-supplied boolean array in place.
 * Throws when all 4 registers are already in use.
 */
export function allocateDR(drAllocation: boolean[]): number {
  for (let i = 0; i < 4; i++) {
    if (!drAllocation[i]) {
      drAllocation[i] = true;
      return i;
    }
  }
  throw new ToolError('PREREQUISITE', 'All 4 hardware breakpoint registers (DR0-DR3) are in use');
}
