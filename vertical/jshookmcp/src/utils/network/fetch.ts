/**
 * Unified outbound `fetch` helper: per-call timeout + error normalization.
 *
 * Connection-pooling note: this helper relies on Node's global `fetch`
 * (undici) default dispatcher for connection reuse and keep-alive. Explicit
 * per-origin Agent pooling would require importing `undici` directly — it is
 * only a transitive dependency of Node's built-in fetch and is NOT declared in
 * package.json, so importing it under pnpm's strict node_modules layout would
 * fail. Declaring `undici` as a dependency and wiring a shared Agent is left as
 * a user decision.
 */

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    // A timeout abort is normalized to a stable, descriptive error so callers
    // do not have to match on the bare DOMException "AbortError" message. A
    // caller-supplied signal abort is rethrown unchanged.
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      const wrapped = new Error(`Fetch timed out after ${timeoutMs}ms: ${String(url)}`);
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
}
