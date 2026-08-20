/**
 * ProtocolAnalysisDnsHandlers — DNS message dissection (RFC 1035 + EDNS(0)).
 */

import type { ToolArgs } from '@server/types';
import { parseDnsMessage, type DnsMessage } from './shared';
import { ProtocolAnalysisPcapngHandlers } from './pcapng-handlers';

const HEX_RE = /^[0-9a-f]*$/iu;

export class ProtocolAnalysisDnsHandlers extends ProtocolAnalysisPcapngHandlers {
  async handleProtoDissectDns(args: ToolArgs): Promise<{
    byteLength: number;
    message: DnsMessage | null;
    success?: boolean;
    error?: string;
  }> {
    try {
      const payload = parseHexInput(args.packetHex);
      const maxPointerDepth =
        args.maxPointerDepth === undefined
          ? undefined
          : parseNonNegativeInteger(args.maxPointerDepth, 'maxPointerDepth');
      const message = parseDnsMessage(payload, { maxPointerDepth });
      this.emitEvent('protocol:dns_dissected', {
        byteLength: payload.length,
        questionCount: message.questionCount,
        answerCount: message.answerCount,
      });
      return {
        byteLength: payload.length,
        message,
        success: true,
      };
    } catch (error) {
      return {
        byteLength: 0,
        message: null,
        success: false,
        error: this.errorMessage(error),
      };
    }
  }
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function parseHexInput(value: unknown): Buffer {
  if (typeof value !== 'string') {
    throw new Error('packetHex must be a hex string');
  }
  const normalized = value.replace(/\s+/g, '').replace(/^0x/iu, '').toLowerCase();
  if (normalized.length % 2 !== 0 || !HEX_RE.test(normalized)) {
    throw new Error('packetHex must be valid even-length hex');
  }
  return Buffer.from(normalized, 'hex');
}
