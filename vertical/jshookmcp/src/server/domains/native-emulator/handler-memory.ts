import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import { argNumber } from '@server/domains/shared/parse-args';
import type { ToolArgs } from '@server/types';

export function rawMemoryLimit(args: ToolArgs): number {
  const limit = getReverseEngineeringConfig().nativeEmulator.rawMemoryMaxBytes;
  const requested = argNumber(args, 'maxBytes', limit);
  return Math.max(1, Math.min(requested, limit));
}

export function ensureRawMemorySize(size: number, limit: number, operation: string): void {
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Invalid raw memory ${operation} size`);
  }
  if (size > limit) {
    throw new Error(`Raw guest memory ${operation} exceeds limit: ${size} > ${limit} bytes`);
  }
}

export function toUint8(buf: Uint8Array): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
