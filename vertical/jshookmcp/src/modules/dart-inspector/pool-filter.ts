/**
 * Server-side predicate filter for Dart ObjectPool slots.
 *
 * `dart_object_pool_dump` returns the entire isolate pool (often tens of
 * thousands of slots). The common reverse question is "is this AES key / URL /
 * integer Smi in the pool?" — this collapses that to a server-side pass instead
 * of dumping everything and filtering client-side.
 */

export interface PoolSlotLike {
  kind: string;
  preview?: string;
}

export interface PoolSlotFilter {
  /** Only return slots whose `kind` matches (e.g. "string", "smi", "functionRef"). */
  typeFilter?: string;
  /** Case-insensitive substring match against the slot's decoded `preview`. */
  valueContains?: string;
}

export function filterPoolSlots<T extends PoolSlotLike>(slots: T[], filter: PoolSlotFilter): T[] {
  let result = slots;
  if (filter.typeFilter) {
    const kind = filter.typeFilter;
    result = result.filter((s) => s.kind === kind);
  }
  if (filter.valueContains) {
    const needle = filter.valueContains.toLowerCase();
    result = result.filter(
      (s) => typeof s.preview === 'string' && s.preview.toLowerCase().includes(needle),
    );
  }
  return result;
}
