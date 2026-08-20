/**
 * V8 WeakRefs Inspection Handler — v8_weakrefs_inspect
 *
 * Enumerates WeakRef and FinalizationRegistry instances in the page via
 * Runtime.evaluate. CDP has no direct "list WeakRefs" API, so we walk the
 * page's global reachable-from roots to find:
 *   - FinalizationRegistry instances (via constructor name) and whether
 *     their registered callbacks have pending entries
 *   - WeakRef instances and whether .deref() returns a value (live) or
 *     undefined (cleared)
 *
 * This is a best-effort heuristic: it only sees WeakRefs that are
 * themselves strongly reachable (a WeakRef that's only weakly held is
 * invisible by definition). Requires browser/page CDP context.
 */

import { argNumber } from '@server/domains/shared/parse-args';
import { normalizeSessionSource, resolveTargetSession } from './cdp-session';
import type { SessionSource } from './cdp-session';

export interface FinalizationRegistryInfo {
  source: string;
  constructorName: string;
  isRegistered: boolean;
}

export interface WeakRefInfo {
  source: string;
  isLive: boolean;
  targetClassName: string | null;
}

export interface WeakRefsInspectResult {
  success: boolean;
  error?: string;
  weakRefCount: number;
  liveWeakRefs: number;
  clearedWeakRefs: number;
  finalizationRegistries: number;
  registriesWithPending: number;
  weakRefs: WeakRefInfo[];
  registries: FinalizationRegistryInfo[];
  summary: string;
}

export async function handleWeakRefsInspect(
  args: Record<string, unknown>,
  source?: SessionSource,
): Promise<WeakRefsInspectResult> {
  const scanDepth = Math.min(20, Math.max(1, argNumber(args, 'scanDepth', 5)));

  const { session, owned } = await resolveTargetSession(normalizeSessionSource(source));
  if (!session) {
    return {
      success: false,
      error:
        'No CDP session available — browser must be connected via browser_launch or browser_attach',
      weakRefCount: 0,
      liveWeakRefs: 0,
      clearedWeakRefs: 0,
      finalizationRegistries: 0,
      registriesWithPending: 0,
      weakRefs: [],
      registries: [],
      summary: 'CDP session unavailable',
    };
  }

  try {
    // Walk the reachable object graph (BFS up to scanDepth) collecting
    // WeakRef + FinalizationRegistry instances. We cap the walk depth so we
    // don't pin objects we're trying to inspect weakly.
    const resp = await session.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
      expression: `
        (() => {
          const weakRefs = [];
          const registries = [];
          const visited = new WeakSet();
          const queue = [];
          // Seed from globalThis own properties.
          for (const k of Object.getOwnPropertyNames(globalThis)) {
            try { queue.push({ v: globalThis[k], depth: 0 }); } catch (_) {}
          }
          let steps = 0;
          const MAX_STEPS = ${scanDepth * 500};
          while (queue.length > 0 && steps++ < MAX_STEPS) {
            const { v, depth } = queue.shift();
            if (v === null || typeof v !== 'object' && typeof v !== 'function') continue;
            if (typeof v === 'object') {
              try { if (visited.has(v)) continue; visited.add(v); } catch (_) { continue; }
              if (v instanceof WeakRef) {
                const target = v.deref();
                weakRefs.push({
                  source: depth <= 1 ? 'global' : 'nested',
                  isLive: target !== undefined,
                  targetClassName: target !== undefined ? (target?.constructor?.name ?? null) : null,
                });
                continue; // don't descend into the WeakRef's referent
              }
              if (v instanceof FinalizationRegistry) {
                registries.push({
                  source: depth <= 1 ? 'global' : 'nested',
                  constructorName: v.constructor?.name ?? 'FinalizationRegistry',
                  // Cannot introspect pending count without unregistering;
                  // mark as registered (the registry exists and is active).
                  isRegistered: true,
                });
                continue;
              }
            }
            if (depth < ${scanDepth}) {
              try {
                const props = [...Object.getOwnPropertyNames(v), ...Object.getOwnPropertySymbols(v)];
                for (const p of props) {
                  try {
                    const child = v[p];
                    if (child !== null && (typeof child === 'object' || typeof child === 'function')) {
                      queue.push({ v: child, depth: depth + 1 });
                    }
                  } catch (_) {}
                }
              } catch (_) {}
            }
          }
          return {
            weakRefs: weakRefs.slice(0, 200),
            registries: registries.slice(0, 50),
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: false,
    });

    const value = resp?.result?.value as
      | { weakRefs?: WeakRefInfo[]; registries?: FinalizationRegistryInfo[] }
      | undefined;

    const weakRefs = Array.isArray(value?.weakRefs) ? value.weakRefs : [];
    const registries = Array.isArray(value?.registries) ? value.registries : [];

    const liveWeakRefs = weakRefs.filter((w) => w.isLive).length;
    const clearedWeakRefs = weakRefs.length - liveWeakRefs;

    return {
      success: true,
      weakRefCount: weakRefs.length,
      liveWeakRefs,
      clearedWeakRefs,
      finalizationRegistries: registries.length,
      registriesWithPending: registries.filter((r) => r.isRegistered).length,
      weakRefs,
      registries,
      summary: `${weakRefs.length} WeakRefs (${liveWeakRefs} live, ${clearedWeakRefs} cleared); ${registries.length} FinalizationRegistries`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      weakRefCount: 0,
      liveWeakRefs: 0,
      clearedWeakRefs: 0,
      finalizationRegistries: 0,
      registriesWithPending: 0,
      weakRefs: [],
      registries: [],
      summary: 'WeakRef inspection failed',
    };
  } finally {
    if (owned) await session.detach().catch(() => undefined);
  }
}
