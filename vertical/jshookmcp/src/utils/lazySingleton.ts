/**
 * Promise-based one-time initialization lock.
 *
 * The first call runs `factory`; concurrent callers share the same
 * in-flight promise instead of re-running init (the promise itself is
 * the lock — no mutex). If init rejects, the cache is cleared so a
 * later call may retry.
 *
 * Usage:
 *   const getRegistry = lazySingleton(() => buildRegistry());
 *   const a = await getRegistry(); // runs factory
 *   const b = await getRegistry(); // reuses the in-flight/settled promise
 */
export function lazySingleton<T>(factory: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;

  return (): Promise<T> => {
    if (cached === undefined) {
      cached = factory().catch((error: unknown) => {
        cached = undefined; // broken lock — allow a later retry
        throw error;
      });
    }
    return cached;
  };
}
