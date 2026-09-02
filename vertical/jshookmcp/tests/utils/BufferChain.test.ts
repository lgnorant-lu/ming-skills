import { describe, expect, it } from 'vitest';
import { BufferChain } from '@utils/BufferChain';

describe('utils/BufferChain', () => {
  it('starts empty', () => {
    const chain = new BufferChain();
    expect(chain.length).toBe(0);
    expect(chain.isEmpty).toBe(true);
    expect(chain.toBuffer().length).toBe(0);
  });

  it('tracks total length across appends', () => {
    const chain = new BufferChain();
    chain.append(Buffer.from('ab'));
    chain.append(Buffer.from('cde'));
    expect(chain.length).toBe(5);
    expect(chain.isEmpty).toBe(false);
  });

  it('ignores empty chunks', () => {
    const chain = new BufferChain();
    chain.append(Buffer.from('ab'));
    chain.append(Buffer.alloc(0));
    expect(chain.length).toBe(2);
  });

  it('concatenates multiple chunks in order', () => {
    const chain = new BufferChain();
    chain.append(Buffer.from('hello '));
    chain.append(Buffer.from('world'));
    expect(chain.toBuffer().toString('utf8')).toBe('hello world');
  });

  it('materializes a single chunk', () => {
    const chain = new BufferChain();
    chain.append(Buffer.from('solo'));
    expect(chain.toBuffer().toString('utf8')).toBe('solo');
  });

  it('returns a copy so external mutation cannot corrupt the chain (single chunk)', () => {
    const chain = new BufferChain();
    chain.append(Buffer.from('abc'));
    const first = chain.toBuffer();
    first[0] = 0x58; // 'X'
    const second = chain.toBuffer();
    expect(second.toString('utf8')).toBe('abc');
  });

  it('returns a copy so external mutation cannot corrupt the chain (after materialization)', () => {
    const chain = new BufferChain();
    chain.append(Buffer.from('ab'));
    chain.append(Buffer.from('cd'));
    const materialized = chain.toBuffer();
    materialized.fill(0x58);
    // Chain state must be unaffected by the caller mutating the returned buffer.
    expect(chain.toBuffer().toString('utf8')).toBe('abcd');
  });

  it('stays consistent when appending after toBuffer materialization', () => {
    const chain = new BufferChain();
    chain.append(Buffer.from('ab'));
    chain.append(Buffer.from('cd'));
    chain.toBuffer(); // materialize
    chain.append(Buffer.from('ef'));
    expect(chain.length).toBe(6);
    expect(chain.toBuffer().toString('utf8')).toBe('abcdef');
  });

  it('multiple toBuffer calls return equal but independent buffers', () => {
    const chain = new BufferChain();
    chain.append(Buffer.from('xy'));
    chain.append(Buffer.from('z'));
    const a = chain.toBuffer();
    const b = chain.toBuffer();
    expect(a.equals(b)).toBe(true);
    expect(a).not.toBe(b);
    a[0] = 0x41;
    expect(b[0]).toBe(0x78); // 'x' untouched
  });

  it('reset releases all chunks', () => {
    const chain = new BufferChain();
    chain.append(Buffer.from('abc'));
    chain.reset();
    expect(chain.length).toBe(0);
    expect(chain.isEmpty).toBe(true);
    expect(chain.toBuffer().length).toBe(0);
  });

  it('append is zero-copy: caller chunk mutation is visible through the chain', () => {
    const chunk = Buffer.from('abc');
    const chain = new BufferChain();
    chain.append(chunk);
    chunk[0] = 0x58;
    expect(chain.toBuffer()[0]).toBe(0x58);
  });
});
