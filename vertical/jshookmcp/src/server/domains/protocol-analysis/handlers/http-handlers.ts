/**
 * ProtocolAnalysisHttpHandlers — HTTP/1.x message dissection (RFC 7230).
 */

import type { ToolArgs } from '@server/types';
import { parseHexPayload, parseHttpMessage, type ParsedHttpMessage } from './shared';
import { ProtocolAnalysisDnsHandlers } from './dns-handlers';

export class ProtocolAnalysisHttpHandlers extends ProtocolAnalysisDnsHandlers {
  async handleProtoDissectHttp(args: ToolArgs): Promise<{
    byteLength: number;
    message: ParsedHttpMessage | null;
    success?: boolean;
    error?: string;
  }> {
    try {
      const payload = parseHexPayload(args.packetHex, 'packetHex');
      const message = parseHttpMessage(payload);
      this.emitEvent('protocol:http_dissected', {
        byteLength: payload.length,
        kind: message.kind,
        headerCount: message.headers.length,
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

// parseHexInput removed — now imported from ./shared (parseHexPayload)
