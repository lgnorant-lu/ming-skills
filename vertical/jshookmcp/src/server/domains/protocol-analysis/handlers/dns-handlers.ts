/**
 * ProtocolAnalysisDnsHandlers — DNS message dissection (RFC 1035 + EDNS(0)).
 */

import type { ToolArgs } from '@server/types';
import {
  parseDnsMessage,
  parseHexPayload,
  parseNonNegativeInteger,
  type DnsMessage,
} from './shared';
import { ProtocolAnalysisPcapngHandlers } from './pcapng-handlers';

export class ProtocolAnalysisDnsHandlers extends ProtocolAnalysisPcapngHandlers {
  async handleProtoDissectDns(args: ToolArgs): Promise<{
    byteLength: number;
    message: DnsMessage | null;
    success?: boolean;
    error?: string;
  }> {
    try {
      const payload = parseHexPayload(args.packetHex, 'packetHex');
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
