/**
 * True LRU cache backed by a Map with delete-reinsert ordering.
 *
 * `get()` reorders (a read counts as a use); `peek()` reads without
 * reordering; `set()` evicts the least-recently-used entry at capacity.
 * Inherits the full Map interface (size, has, delete, clear, iteration,
 * ...) — only access is kept LRU-ordered.
 *
 * Usage:
 *   const cache = new LruMap<string, number>(100);
 *   cache.set('a', 1);
 *   cache.get('a');       // promotes 'a' to most-recently-used
 *   cache.peek('a');      // read without promoting
 */
export class LruMap<K, V> extends Map<K, V> {
  private readonly capacity: number;
  constructor(capacity: number) {
    super();
    this.capacity = capacity;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('LruMap capacity must be an integer >= 1');
    }
  }

  /** Read + promote: delete-reinsert moves the entry to the tail (MRU). */
  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key)!;
    super.delete(key);
    super.set(key, value);
    return value;
  }

  /** Read without promoting; the entry keeps its LRU position. */
  peek(key: K): V | undefined {
    return super.get(key);
  }

  override set(key: K, value: V): this {
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    if (super.size > this.capacity) {
      // Map keys iterate in insertion order, so the head is the LRU entry.
      const oldest = super.keys().next().value;
      if (oldest !== undefined) super.delete(oldest);
    }
    return this;
  }
}
