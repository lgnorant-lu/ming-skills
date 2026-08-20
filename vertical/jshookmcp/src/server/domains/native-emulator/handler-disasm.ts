import type { OpcodeInput } from '@modules/native-emulator/disasm';

export function parseOpcodeInput(value: unknown): OpcodeInput {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('opcode number must be a finite unsigned integer');
    }
    return Math.trunc(value) >>> 0;
  }

  if (typeof value !== 'string') {
    throw new Error('Missing required opcode argument');
  }

  const trimmed = value.trim();
  if (!trimmed) throw new Error('opcode must not be empty');

  if (/^(?:0x)?[0-9a-f]+$/i.test(trimmed) && trimmed.replace(/^0x/i, '').length > 2) {
    return Number.parseInt(trimmed.replace(/^0x/i, ''), 16) >>> 0;
  }

  const parts = trimmed.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const bytes = parts.map((part) => {
    const hex = part.replace(/^0x/i, '');
    if (!/^[0-9a-f]{1,2}$/i.test(hex)) {
      throw new Error(`Invalid opcode byte: ${part}`);
    }
    return Number.parseInt(hex, 16);
  });
  if (bytes.length === 0) throw new Error('opcode must include at least one byte');
  return bytes;
}

export function parseProgramCounter(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return BigInt(trimmed);
  if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
  throw new Error(`Invalid pc: ${value}`);
}

export function formatOpcodeInput(opcode: OpcodeInput): string {
  if (typeof opcode === 'number') return `0x${opcode.toString(16)}`;
  return Array.from(opcode, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
}
