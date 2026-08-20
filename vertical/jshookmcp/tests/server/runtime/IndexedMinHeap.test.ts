import { describe, expect, it } from 'vitest';
import { IndexedMinHeap } from '@server/runtime/IndexedMinHeap';

interface Value {
  priority: number;
  index: number;
}

describe('IndexedMinHeap', () => {
  it('orders values and removes arbitrary entries in logarithmic heap operations', () => {
    const heap = new IndexedMinHeap<Value>({
      compare: (left, right) => left.priority - right.priority,
      getIndex: (value) => value.index,
      setIndex: (value, index) => {
        value.index = index;
      },
    });
    const values = [8, 3, 5, 1, 9, 2].map((priority) => ({ priority, index: -1 }));
    for (const value of values) heap.push(value);

    expect(heap.remove(values[2]!)).toBe(true);
    expect(values[2]!.index).toBe(-1);

    const ordered: number[] = [];
    while (heap.size > 0) ordered.push(heap.pop()!.priority);
    expect(ordered).toEqual([1, 2, 3, 8, 9]);
    expect(values.every((value) => value.index === -1)).toBe(true);
  });
});
