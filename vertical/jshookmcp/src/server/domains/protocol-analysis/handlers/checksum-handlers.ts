/**
 * ProtocolAnalysisChecksumHandlers — checksum mutation helpers.
 */

import type { ToolArgs } from '@server/types';
import {
  computeInternetChecksum,
  parseChecksumEndian,
  parseHexPayload,
  parseNonNegativeInteger,
  parsePositiveInteger,
} from './shared';
import { ProtocolAnalysisIpPacketHandlers } from './ip-packet-handlers';

export class ProtocolAnalysisChecksumHandlers extends ProtocolAnalysisIpPacketHandlers {
  async handleChecksumApply(args: ToolArgs): Promise<{
    checksumHex: string;
    checksum: number;
    mutatedHex: string;
    byteLength: number;
    rangeStart: number;
    rangeEnd: number;
    success?: boolean;
    error?: string;
  }> {
    try {
      const payload = parseHexPayload(args.hexPayload, 'hexPayload');
      const rangeStart =
        args.startOffset === undefined
          ? 0
          : parseNonNegativeInteger(args.startOffset, 'startOffset');
      const rangeEnd =
        args.endOffset === undefined
          ? payload.length
          : parseNonNegativeInteger(args.endOffset, 'endOffset');
      if (rangeStart > rangeEnd || rangeEnd > payload.length) {
        throw new Error('checksum range must stay within the payload');
      }

      const zeroOffset =
        args.zeroOffset === undefined
          ? undefined
          : parseNonNegativeInteger(args.zeroOffset, 'zeroOffset');
      const zeroLength =
        args.zeroLength === undefined ? 2 : parsePositiveInteger(args.zeroLength, 'zeroLength');
      const writeOffset =
        args.writeOffset === undefined
          ? zeroOffset
          : parseNonNegativeInteger(args.writeOffset, 'writeOffset');
      const endian = parseChecksumEndian(args.endian);

      const working = Buffer.from(payload);
      if (zeroOffset !== undefined) {
        if (zeroOffset + zeroLength > working.length) {
          throw new Error('zeroOffset and zeroLength must stay within the payload');
        }
        working.fill(0, zeroOffset, zeroOffset + zeroLength);
      }

      const checksum = computeInternetChecksum(working.subarray(rangeStart, rangeEnd));
      if (writeOffset !== undefined) {
        if (writeOffset + 2 > working.length) {
          throw new Error('writeOffset must leave room for a 16-bit checksum field');
        }
        if (endian === 'little') {
          working.writeUInt16LE(checksum, writeOffset);
        } else {
          working.writeUInt16BE(checksum, writeOffset);
        }
      }

      const checksumHex = checksum.toString(16).padStart(4, '0');
      this.emitEvent('protocol:checksum_applied', {
        checksumHex,
        byteLength: working.length,
      });
      return {
        checksumHex,
        checksum,
        mutatedHex: working.toString('hex'),
        byteLength: working.length,
        rangeStart,
        rangeEnd,
        success: true,
      };
    } catch (error) {
      return {
        checksumHex: '',
        checksum: 0,
        mutatedHex: '',
        byteLength: 0,
        rangeStart: 0,
        rangeEnd: 0,
        success: false,
        error: this.errorMessage(error),
      };
    }
  }
}
