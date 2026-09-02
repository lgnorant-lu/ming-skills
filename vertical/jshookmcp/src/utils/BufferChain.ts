/**
 * Zero-copy buffer chain — avoids repeated Buffer.concat allocations.
 *
 * Appends chunks without copying. Materializes into a single Buffer only
 * when `toBuffer()` is called. Tracks total byte length for size limits.
 *
 * `toBuffer()` always returns a fresh copy of the accumulated data, so a
 * caller mutating the returned Buffer can never corrupt the chain's internal
 * state (important for callers that buffer network streams and reuse or
 * keep the chain alive after materializing). Appending stays zero-copy;
 * the only copies happen at materialization time.
 */
export class BufferChain {
  private chunks: Buffer[] = [];
  private totalLength = 0;

  /** Number of bytes accumulated so far. */
  get length(): number {
    return this.totalLength;
  }

  /** Append a chunk without copying. */
  append(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }

  /**
   * Materialize all chunks into a single Buffer.
   *
   * Returns a copy independent of the chain: mutating the result cannot
   * affect later `toBuffer()` calls or subsequent appends. The internal
   * materialized buffer is kept so repeated calls stay cheap.
   */
  toBuffer(): Buffer {
    if (this.chunks.length === 0) return Buffer.alloc(0);
    if (this.chunks.length === 1) return Buffer.from(this.chunks[0]!);
    const result = Buffer.concat(this.chunks, this.totalLength);
    this.chunks = [result];
    return Buffer.from(result);
  }

  /** Reset the chain, releasing all chunk references. */
  reset(): void {
    this.chunks = [];
    this.totalLength = 0;
  }

  /** Whether any data has been accumulated. */
  get isEmpty(): boolean {
    return this.totalLength === 0;
  }
}
