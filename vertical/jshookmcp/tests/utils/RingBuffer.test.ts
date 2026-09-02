import { describe, expect, it } from 'vitest';
import { RingBuffer } from '@utils/RingBuffer';

describe('RingBuffer', () => {
  it('starts empty and shift on empty returns undefined', () => {
    const buffer = new RingBuffer<number>(3);
    expect(buffer.length).toBe(0);
    expect(buffer.shift()).toBeUndefined();
  });

  it('preserves FIFO order for basic push/shift', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    expect(buffer.toArray()).toEqual([1, 2, 3]);
    expect(buffer.shift()).toBe(1);
    expect(buffer.shift()).toBe(2);
    expect(buffer.length).toBe(1);
  });

  it('overwrites oldest item when full at fixed capacity', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);

    expect(buffer.length).toBe(3);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it('supports iterator and map based on logical order', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(10);
    buffer.push(20);
    buffer.push(30);
    buffer.push(40);

    expect([...buffer]).toEqual([20, 30, 40]);
    expect(buffer.map((value, index) => `${index}:${value}`)).toEqual(['0:20', '1:30', '2:40']);
  });

  it('clear resets internal state and allows grow path for large capacity', () => {
    const buffer = new RingBuffer<number>(128);
    buffer.push(1);
    buffer.push(2);
    buffer.clear();
    expect(buffer.length).toBe(0);

    for (let i = 0; i < 70; i++) {
      buffer.push(i);
    }

    expect(buffer.length).toBe(70);
    expect(buffer.toArray()[0]).toBe(0);
    expect(buffer.toArray()[69]).toBe(69);
  });

  it('rejects storing undefined so shift() keeps a single empty signal', () => {
    const buffer = new RingBuffer<number | undefined>(3);
    expect(() => buffer.push(undefined)).toThrow(TypeError);
    expect(buffer.length).toBe(0);
  });

  it('peek() returns the oldest element without removing it', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    expect(buffer.peek()).toBe(1);
    // Peek is a read-only O(1) lookup: the logical contents and length are
    // unchanged.
    expect(buffer.length).toBe(3);
    expect(buffer.toArray()).toEqual([1, 2, 3]);
  });

  it('peek() returns undefined when empty', () => {
    expect(new RingBuffer<number>(3).peek()).toBeUndefined();
  });

  it('peek() reflects the overwrite of the oldest slot at capacity', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4); // overwrites 1

    expect(buffer.peek()).toBe(2);
  });

  it('iterates over a snapshot even when the buffer is mutated mid-iteration', () => {
    const buffer = new RingBuffer<number>(4);
    buffer.push(1);
    buffer.push(2);

    // Iterator creation takes the snapshot; later mutations must not corrupt it.
    const iterator = buffer[Symbol.iterator]();
    buffer.push(3);
    buffer.shift();

    expect(iterator.next()).toEqual({ value: 1, done: false });
    expect(iterator.next()).toEqual({ value: 2, done: false });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});
