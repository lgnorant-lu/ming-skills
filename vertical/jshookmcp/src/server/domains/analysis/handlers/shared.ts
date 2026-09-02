/**
 * Shared helpers for analysis handlers.
 */

import type { ToolArgs } from '@server/types';

/**
 * Extract the `code` argument, returning `null` when absent, non-string, or blank.
 * The caller decides the error message, keeping the validation rule in one place.
 */
export function requireCodeArg(args: ToolArgs): string | null {
  const code = args.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return null;
  }
  return code;
}
