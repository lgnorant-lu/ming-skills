/**
 * Fixed-capacity ring buffer with O(1) push/shift.
 * Drop-in replacement for arrays used as bounded FIFO queues.
 */
export class RingBuffer<T> {
  private capacity: number;
  private buf: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = Array.from<T | undefined>({ length: capacity });
  }

  get length(): number {
    return this.count;
  }

  push(item: T): void {
    // shift() uses undefined as the "buffer empty" sentinel, so storing an
    // undefined value would make the two states indistinguishable.
    if (item === undefined) {
      throw new TypeError('RingBuffer cannot store undefined values');
    }
    if (this.count === this.buf.length) {
      // Buffer full — grow by 2x up to capacity, or overwrite oldest
      if (this.buf.length < this.capacity) {
        this.grow();
      } else {
        // Overwrite oldest
        this.buf[this.tail] = item;
        this.tail = (this.tail + 1) % this.buf.length;
        this.head = (this.head + 1) % this.buf.length;
        return;
      }
    }
    this.buf[this.tail] = item;
    this.tail = (this.tail + 1) % this.buf.length;
    this.count++;
  }

  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.buf[this.head];
    this.buf[this.head] = undefined; // allow GC
    this.head = (this.head + 1) % this.buf.length;
    this.count--;
    return item;
  }

  /** Return the oldest element without removing it (O(1)). */
  peek(): T | undefined {
    if (this.count === 0) return undefined;
    return this.buf[this.head];
  }

  clear(): void {
    this.buf = Array.from<T | undefined>({ length: Math.min(64, this.capacity) });
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  [Symbol.iterator](): Iterator<T> {
    // Iterate over a snapshot: callers that push/shift while consuming (e.g.
    // draining inside a for-of loop) would otherwise see a corrupted walk as
    // head/tail move under the iterator.
    return this.toArray()[Symbol.iterator]();
  }

  toArray(): T[] {
    const result: T[] = Array.from<T>({ length: this.count });
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(this.head + i) % this.buf.length] as T;
    }
    return result;
  }

  map<U>(fn: (item: T, index: number) => U): U[] {
    const result: U[] = Array.from<U>({ length: this.count });
    for (let i = 0; i < this.count; i++) {
      result[i] = fn(this.buf[(this.head + i) % this.buf.length] as T, i);
    }
    return result;
  }

  private grow(): void {
    const newSize = Math.min(this.buf.length * 2, this.capacity);
    const newBuf = Array.from<T | undefined>({ length: newSize });
    for (let i = 0; i < this.count; i++) {
      newBuf[i] = this.buf[(this.head + i) % this.buf.length];
    }
    this.buf = newBuf;
    this.head = 0;
    this.tail = this.count;
  }
}
