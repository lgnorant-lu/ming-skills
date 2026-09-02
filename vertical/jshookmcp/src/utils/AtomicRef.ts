/**
 * RCU-style atomic reference for read-mostly state.
 *
 * `get()` is a zero-cost snapshot read; `update()` computes a new value
 * from the current one and publishes it with a single assignment —
 * atomic in single-threaded JS, so concurrent readers always observe
 * either the old or the new value, never a partially-written one.
 *
 * Usage:
 *   const views = new AtomicRef(emptyViews());
 *   const snapshot = views.get();                    // zero-cost read
 *   views.update((v) => ({ ...v, newView }));        // copy-then-swap
 */
export class AtomicRef<T> {
  private current: T;

  constructor(initial: T) {
    this.current = initial;
  }

  /** Zero-cost read: returns the current value reference (a snapshot). */
  get(): T {
    return this.current;
  }

  /**
   * Copy-then-swap update. `fn` receives the current value and must
   * return a fresh value (do not mutate the received reference in
   * place — other readers may still hold it). Returns the new value.
   */
  update(fn: (current: T) => T): T {
    const next = fn(this.current);
    this.current = next;
    return next;
  }

  /** Replace the value directly; returns it for chaining. */
  set(value: T): T {
    this.current = value;
    return value;
  }
}
