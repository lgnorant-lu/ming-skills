import type { EventBus, ServerEventMap } from '@server/EventBus';
import { R } from '@server/domains/shared/ResponseBuilder';
import { parseOptionalString } from './raw-helpers';
import {
  parseGrpcFrames,
  buildGrpcBody,
  type GrpcBuildMessage,
} from '@server/domains/network/grpc-raw';
import { emitEvent, parseNumberArg } from './shared';

export class RawGrpcHandlers {
  constructor(private readonly eventBus?: EventBus<ServerEventMap>) {}

  async handleGrpcFrameParse(args: Record<string, unknown>) {
    const data = parseOptionalString(args.data, 'data');
    if (!data) {
      throw new Error('data is required');
    }
    const encoding = (parseOptionalString(args.encoding, 'encoding') ?? 'hex') as 'hex' | 'base64';
    if (encoding !== 'hex' && encoding !== 'base64') {
      throw new Error('encoding must be one of: hex, base64');
    }

    const result = parseGrpcFrames(data, encoding);

    emitEvent(this.eventBus, 'network:grpc_frame_parsed', {
      messageCount: result.frames.length,
      totalBytes: result.totalBytes,
      timestamp: new Date().toISOString(),
    });

    return R.ok()
      .merge(result as unknown as Record<string, unknown>)
      .json();
  }

  async handleGrpcFrameBuild(args: Record<string, unknown>) {
    if (!Array.isArray(args.messages)) {
      throw new Error('messages must be an array');
    }
    const messages: GrpcBuildMessage[] = (args.messages as Array<Record<string, unknown>>).map(
      (entry, index) => {
        if (typeof entry !== 'object' || entry === null) {
          throw new Error(`messages[${String(index)}] must be an object`);
        }
        const payloadHex =
          typeof entry.payloadHex === 'string'
            ? entry.payloadHex
            : (() => {
                throw new Error(`messages[${String(index)}].payloadHex must be a string`);
              })();
        const compressed =
          entry.compressed !== undefined
            ? parseNumberArg(entry.compressed, {
                defaultValue: 0,
                min: 0,
                max: 1,
                integer: true,
              }) === 1
            : undefined;
        const isTrailer =
          entry.isTrailer !== undefined
            ? parseNumberArg(entry.isTrailer, {
                defaultValue: 0,
                min: 0,
                max: 1,
                integer: true,
              }) === 1
            : undefined;
        return {
          payloadHex,
          ...(compressed !== undefined && { compressed }),
          ...(isTrailer !== undefined && { isTrailer }),
        };
      },
    );

    const result = buildGrpcBody(messages);

    emitEvent(this.eventBus, 'network:grpc_frame_built', {
      messageCount: result.messageCount,
      bytes: result.bytes,
      timestamp: new Date().toISOString(),
    });

    return R.ok()
      .merge(result as unknown as Record<string, unknown>)
      .json();
  }
}
