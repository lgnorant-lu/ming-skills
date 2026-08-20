/**
 * gRPC length-prefixed message framing (gRPC over HTTP/2 + gRPC-Web).
 *
 * A gRPC request/response body is a sequence of length-prefixed messages. Each
 * message is encoded as:
 *
 *   +-------------------+----------------------+------------------+
 *   | compressed-flag   | message-length (BE)  | message bytes    |
 *   | 1 byte            | 4 bytes              | message-length   |
 *   +-------------------+----------------------+------------------+
 *
 * - compressed-flag bit 0 (0x01): the message is compressed (per the
 *   grpc-encoding header, e.g. gzip). Payload is the compressed protobuf.
 * - compressed-flag bit 7 (0x80): gRPC-Web trailer frame. The payload is ASCII
 *   trailers ("grpc-status:0\r\n..."), NOT a protobuf message.
 *
 * This pure decoder splits a captured body into its constituent messages so
 * each can be fed to protobuf_decode_raw. It is the missing primitive in the
 * gRPC reverse-engineering chain: capture body (CDP) -> grpc_frame_parse ->
 * protobuf_decode_raw.
 */

const GRPC_FRAME_HEADER_BYTES = 5; // 1 flag + 4 length
const GRPC_COMPRESSED_FLAG = 0x01;
const GRPC_TRAILER_FLAG = 0x80;
const MAX_DECLARED_LENGTH = 0xffff_ffff;

export interface GrpcMessageFrame {
  /** Zero-based position of this message in the stream. */
  index: number;
  /** compressed-flag bit 0 set (payload is compressed per grpc-encoding). */
  compressed: boolean;
  /** compressed-flag bit 7 set (gRPC-Web trailer frame; payload is ASCII trailers). */
  isTrailer: boolean;
  /** Raw flag byte (0-255) for full fidelity. */
  flag: number;
  /** Length declared in the 4-byte prefix. */
  declaredLength: number;
  /** Actual payload bytes captured (may be < declaredLength on truncation). */
  payloadBytes: number;
  /** Payload as lowercase hex. */
  payloadHex: string;
  /** Payload as base64 (feed directly to protobuf_decode_raw). */
  payloadBase64: string;
  /** True when the captured payload is shorter than declared (truncated capture). */
  truncated: boolean;
}

export interface ParsedGrpcFrames {
  frames: GrpcMessageFrame[];
  totalBytes: number;
  warnings: string[];
}

function decodeInput(data: string, encoding: 'hex' | 'base64'): Buffer {
  const normalized = data.replace(/\s+/g, '').trim();
  if (normalized.length === 0) {
    throw new Error('data must be a non-empty string');
  }
  if (encoding === 'hex') {
    if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
      throw new Error('data must be an even-length hexadecimal string when encoding=hex');
    }
    return Buffer.from(normalized, 'hex');
  }
  // base64 — tolerate URL-safe chars (-/_) per RFC 4648 §5.
  const reBase64 = /^[A-Za-z0-9+/_-]*={0,2}$/;
  if (!reBase64.test(normalized)) {
    throw new Error('data must be valid base64 when encoding=base64');
  }
  const reflowed = normalized.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(reflowed, 'base64');
}

/**
 * Split a gRPC/gRPC-Web body into its length-prefixed messages.
 *
 * Lenient: a truncated trailing message (declared length exceeds remaining
 * bytes) is still emitted with the captured payload + a warning rather than
 * discarded, so a partial capture remains analysable. Stray trailing bytes too
 * short for a header are reported via a warning.
 */
export function parseGrpcFrames(
  data: string,
  encoding: 'hex' | 'base64' = 'hex',
): ParsedGrpcFrames {
  const buffer = decodeInput(data, encoding);
  const frames: GrpcMessageFrame[] = [];
  const warnings: string[] = [];
  let offset = 0;

  while (offset + GRPC_FRAME_HEADER_BYTES <= buffer.length) {
    const flag = buffer[offset]!;
    const declaredLength = buffer.readUInt32BE(offset + 1);
    const payloadStart = offset + GRPC_FRAME_HEADER_BYTES;
    const available = buffer.length - payloadStart;

    if (declaredLength > available) {
      // Truncated message — emit what we have and stop.
      const payload = buffer.subarray(payloadStart);
      frames.push({
        index: frames.length,
        compressed: (flag & GRPC_COMPRESSED_FLAG) !== 0,
        isTrailer: (flag & GRPC_TRAILER_FLAG) !== 0,
        flag,
        declaredLength,
        payloadBytes: payload.length,
        payloadHex: payload.toString('hex'),
        payloadBase64: payload.toString('base64'),
        truncated: true,
      });
      warnings.push(
        `message ${String(frames.length - 1)} declares ${String(declaredLength)} payload bytes but only ${String(available)} remain; captured partial payload`,
      );
      break;
    }

    const payload = buffer.subarray(payloadStart, payloadStart + declaredLength);
    frames.push({
      index: frames.length,
      compressed: (flag & GRPC_COMPRESSED_FLAG) !== 0,
      isTrailer: (flag & GRPC_TRAILER_FLAG) !== 0,
      flag,
      declaredLength,
      payloadBytes: declaredLength,
      payloadHex: payload.toString('hex'),
      payloadBase64: payload.toString('base64'),
      truncated: false,
    });
    offset = payloadStart + declaredLength;
  }

  // The loop only exits with leftover in 0..4 (>= 5 would have continued).
  const leftover = buffer.length - offset;
  if (leftover > 0) {
    warnings.push(
      frames.length === 0
        ? `input is ${String(buffer.length)} bytes, shorter than a single gRPC frame header (5 bytes); no messages parsed`
        : `trailing ${String(leftover)} bytes after last complete message; ignored`,
    );
  }

  return { frames, totalBytes: buffer.length, warnings };
}

/**
 * Encode one or more gRPC messages into a length-prefixed body. The inverse of
 * parseGrpcFrames — supports building test/capture bodies for replay.
 */
export interface GrpcBuildMessage {
  /** Payload bytes as hex. */
  payloadHex: string;
  /** Set the compressed flag (bit 0). Default false. */
  compressed?: boolean;
  /** Set the gRPC-Web trailer flag (bit 7). Default false. */
  isTrailer?: boolean;
}

export interface BuiltGrpcBody {
  /** Encoded body as lowercase hex. */
  hex: string;
  /** Encoded body as base64. */
  base64: string;
  /** Total byte length. */
  bytes: number;
  /** Number of messages encoded. */
  messageCount: number;
}

function decodePayloadHex(payloadHex: string, index: number): Buffer {
  const normalized = payloadHex.replace(/\s+/g, '').trim();
  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(normalized)) {
    throw new Error(`messages[${String(index)}].payloadHex must be an even-length hex string`);
  }
  return Buffer.from(normalized, 'hex');
}

export function buildGrpcBody(messages: GrpcBuildMessage[]): BuiltGrpcBody {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }
  const chunks: Buffer[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const payload = decodePayloadHex(msg.payloadHex, i);
    if (payload.length > MAX_DECLARED_LENGTH) {
      throw new Error(
        `messages[${String(i)}].payload exceeds the 4-byte gRPC length limit (${String(MAX_DECLARED_LENGTH)} bytes)`,
      );
    }
    const header = Buffer.alloc(GRPC_FRAME_HEADER_BYTES);
    let flag = 0;
    if (msg.compressed) flag |= GRPC_COMPRESSED_FLAG;
    if (msg.isTrailer) flag |= GRPC_TRAILER_FLAG;
    header[0] = flag;
    header.writeUInt32BE(payload.length, 1);
    chunks.push(header, payload);
  }
  const body = Buffer.concat(chunks);
  return {
    hex: body.toString('hex'),
    base64: body.toString('base64'),
    bytes: body.length,
    messageCount: messages.length,
  };
}
