/**
 * ProtocolAnalysisHttpHandlers — HTTP/1.x message dissection (RFC 7230).
 */

import type { ToolArgs } from '@server/types';
import { parseHttpMessage, type ParsedHttpMessage } from './shared';
import { ProtocolAnalysisDnsHandlers } from './dns-handlers';

const HEX_RE = /^[0-9a-f]*$/iu;

export class ProtocolAnalysisHttpHandlers extends ProtocolAnalysisDnsHandlers {
  async handleProtoDissectHttp(args: ToolArgs): Promise<{
    byteLength: number;
    message: ParsedHttpMessage | null;
    success?: boolean;
    error?: string;
  }> {
    try {
      const payload = parseHexInput(args.packetHex);
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
