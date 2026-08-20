/**
 * Shared runtime type guards.
 *
 * Previously each caller (config loader, domain handlers) defined its own
 * `isRecord` with subtly different shapes — some even admitted arrays. This
 * module is the single definition; consumers import it instead of re-declaring.
 */

/** True when a value is a plain (non-null, non-array) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
