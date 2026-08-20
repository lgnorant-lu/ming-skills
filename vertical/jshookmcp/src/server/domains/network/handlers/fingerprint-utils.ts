import { createHash } from 'node:crypto';

export function sha256trunc12(input: string): string {
  return createHash('sha256').update(input).digest('hex').substring(0, 12);
}

export function toHex4(val: string): string {
  return val.replace('0x', '').toLowerCase().padStart(4, '0');
}

// GREASE values per draft-davidben-tls-grease-01
const GREASE_HEX = new Set([
  '0a0a',
  '1a1a',
  '2a2a',
  '3a3a',
  '4a4a',
  '5a5a',
  '6a6a',
  '7a7a',
  '8a8a',
  '9a9a',
  'aaaa',
  'baba',
  'caca',
  'dada',
  'eaea',
  'fafa',
]);

export function isGrease(hex: string): boolean {
  return GREASE_HEX.has(hex.replace('0x', '').toLowerCase().padStart(4, '0'));
}
