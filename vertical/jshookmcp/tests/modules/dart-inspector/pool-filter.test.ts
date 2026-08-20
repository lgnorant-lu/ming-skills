import { describe, expect, it } from 'vitest';
import { filterPoolSlots } from '@modules/dart-inspector/pool-filter';

const SLOTS = [
  { kind: 'string', preview: 'api-response-endpoint', offset: 0 },
  { kind: 'smi', preview: '42', offset: 8 },
  { kind: 'string', preview: 'AES-256-Key', offset: 16 },
  { kind: 'functionRef', offset: 24 },
  { kind: 'string', preview: 'hello world', offset: 32 },
];

describe('filterPoolSlots', () => {
  it('filters by type', () => {
    expect(filterPoolSlots(SLOTS, { typeFilter: 'string' })).toHaveLength(3);
    expect(filterPoolSlots(SLOTS, { typeFilter: 'smi' })).toHaveLength(1);
    expect(filterPoolSlots(SLOTS, { typeFilter: 'functionRef' })).toHaveLength(1);
  });

  it('filters by value substring (case-insensitive)', () => {
    const r = filterPoolSlots(SLOTS, { valueContains: 'API' });
    expect(r).toHaveLength(1);
    expect(r[0]!.preview).toBe('api-response-endpoint');
  });

  it('combines type + value predicates', () => {
    expect(filterPoolSlots(SLOTS, { typeFilter: 'string', valueContains: 'key' })).toHaveLength(1);
  });

  it('returns all slots when no filter is supplied', () => {
    expect(filterPoolSlots(SLOTS, {})).toHaveLength(5);
  });

  it('skips slots without a preview when valueContains is set', () => {
    const r = filterPoolSlots(SLOTS, { valueContains: 'anything' });
    // functionRef has no preview → never matches
    expect(r.every((s) => 'preview' in s)).toBe(true);
  });
});
