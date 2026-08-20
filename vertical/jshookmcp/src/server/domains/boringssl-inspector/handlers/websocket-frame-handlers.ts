/**
 * BoringsslInspectorWebSocketFrameHandlers — WebSocket session/frame operations.
 */

import { argBool, argEnum, argNumber, argString } from '@server/domains/shared/parse-args';
import type { ServerEventMap } from '@server/EventBus';
import type { WebSocketEventName, WebSocketFrameType, WebSocketSession } from './shared';
import {
  encodeWebSocketFrame,
  errorMessage,
  isHex,
  normalizeHex,
  serializeWebSocketSessionState,
  tryConsumeWebSocketFrame,
  waitForWebSocketActivity,
  wakeWebSocketWaiters,
} from './shared';
import { BoringsslInspectorSessionHandlers } from './session-handlers';

export class BoringsslInspectorWebSocketFrameHandlers extends BoringsslInspectorSessionHandlers {
  protected emitWebSocketEvent<K extends WebSocketEventName>(
    event: K,
    payload: ServerEventMap[K],
  ): void {
    void this.eventBus?.emit(event, payload);
  }

  protected attachWebSocketSession(session: WebSocketSession): void {
    const parseBufferedFrames = (): void => {
      while (session.parserBuffer.length > 0) {
        let consumed: ReturnType<typeof tryConsumeWebSocketFrame>;
        try {
          consumed = tryConsumeWebSocketFrame(session.parserBuffer);
        } catch (error) {
          session.error = errorMessage(error);
          session.socket.destroy();
          break;
        }

        if (!consumed) {
          break;
        }

        session.parserBuffer = session.parserBuffer.subarray(consumed.bytesConsumed);
        const frame = consumed.frame;
        session.frames.push(frame);

        if (frame.type === 'ping' && !session.closeSent && !session.socket.destroyed) {
          const pongFrame = encodeWebSocketFrame('pong', frame.data);
          session.socket.write(pongFrame);
          this.emitWebSocketEvent('websocket:session_written', {
            sessionId: session.id,
            frameType: 'pong',
            byteLength: frame.data.length,
            automatic: true,
            timestamp: new Date().toISOString(),
          });
        }

        if (frame.type === 'close') {
          session.closeReceived = true;
          if (!session.closeSent && !session.socket.destroyed) {
            session.closeSent = true;
            session.socket.write(
              encodeWebSocketFrame('close', frame.data, frame.closeCode, frame.closeReason),
            );
            this.emitWebSocketEvent('websocket:session_written', {
              sessionId: session.id,
              frameType: 'close',
              byteLength: frame.data.length,
              automatic: true,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      wakeWebSocketWaiters(session);
    };

    session.socket.on('data', (chunk: Buffer) => {
      session.parserBuffer = Buffer.concat([session.parserBuffer, chunk]);
      parseBufferedFrames();
    });

    session.socket.on('end', () => {
      session.ended = true;
      wakeWebSocketWaiters(session);
    });

    session.socket.on('close', () => {
      session.closed = true;
      wakeWebSocketWaiters(session);
    });

    session.socket.on('error', (error: Error) => {
      session.error = error.message;
      wakeWebSocketWaiters(session);
    });

    parseBufferedFrames();
  }

  protected async readWebSocketFrame(
    session: WebSocketSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    if (session.activeRead) {
      return {
        ok: false,
        error: `Session "${session.id}" already has a pending read`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeWebSocketSessionState(session),
      };
    }

    session.activeRead = true;
    const startedAt = Date.now();

    try {
      while (true) {
        const frame = session.frames.shift();
        if (frame) {
          this.emitWebSocketEvent('websocket:frame_read', {
            sessionId: session.id,
            frameType: frame.type,
            byteLength: frame.data.length,
            timestamp: new Date().toISOString(),
          });
          return {
            ok: true,
            sessionId: session.id,
            kind: session.kind,
            scheme: session.scheme,
            frameType: frame.type,
            fin: frame.fin,
            opcode: frame.opcode,
            masked: frame.masked,
            byteLength: frame.data.length,
            dataHex: frame.data.toString('hex').toUpperCase(),
            dataText: frame.type === 'binary' ? null : frame.data.toString('utf8'),
            closeCode: frame.closeCode,
            closeReason: frame.closeReason,
            elapsedMs: Date.now() - startedAt,
            state: serializeWebSocketSessionState(session),
          };
        }

        if (session.error) {
          return {
            ok: false,
            error: session.error,
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }

        if (session.closed || session.ended) {
          return {
            ok: false,
            error: 'socket closed before a WebSocket frame was available',
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }

        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }

        const hadActivity = await waitForWebSocketActivity(session, remainingMs);
        if (!hadActivity) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }
      }
    } finally {
      session.activeRead = false;
    }
  }

  protected async sendWebSocketFrame(
    session: WebSocketSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (session.closed || session.socket.destroyed) {
      return {
        ok: false,
        error: `Session "${session.id}" is already closed`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeWebSocketSessionState(session),
      };
    }

    const frameType = argEnum(
      args,
      'frameType',
      new Set<WebSocketFrameType>(['text', 'binary', 'ping', 'pong', 'close']),
    );
    if (!frameType) {
      return { ok: false, error: 'frameType is required' };
    }
    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (dataHex && dataText) {
      return { ok: false, error: 'dataHex and dataText are mutually exclusive' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    let payload = Buffer.alloc(0);
    if (dataHex) {
      const normalized = normalizeHex(dataHex);
      if (!isHex(normalized)) {
        return { ok: false, error: 'dataHex must be valid even-length hexadecimal data' };
      }
      payload = Buffer.from(normalized, 'hex');
    } else if (dataText !== undefined) {
      payload = Buffer.from(dataText, 'utf8');
    }

    let closeCode: number | null = null;
    let closeReason: string | null = null;
    if (frameType === 'close') {
      const rawCloseCode = argNumber(args, 'closeCode');
      if (rawCloseCode !== undefined) {
        if (!Number.isInteger(rawCloseCode) || rawCloseCode < 1000 || rawCloseCode > 4999) {
          return { ok: false, error: 'closeCode must be an integer between 1000 and 4999' };
        }
        closeCode = rawCloseCode;
      }
      closeReason = argString(args, 'closeReason') ?? null;
      if (dataHex || dataText) {
        return {
          ok: false,
          error: 'close frames use closeCode/closeReason instead of dataHex/dataText',
        };
      }
      session.closeSent = true;
    }

    if (frameType === 'text' && dataHex) {
      return { ok: false, error: 'text frames require UTF-8 dataText instead of dataHex' };
    }

    const frameBuffer = encodeWebSocketFrame(frameType, payload, closeCode, closeReason);
    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (result: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('error', onError);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          ok: false,
          error: 'write timed out',
          sessionId: session.id,
          kind: session.kind,
          state: serializeWebSocketSessionState(session),
        });
      }, timeoutMs);

      const onError = (error: Error): void => {
        finish({
          ok: false,
          error: error.message,
          sessionId: session.id,
          kind: session.kind,
          state: serializeWebSocketSessionState(session),
        });
      };

      session.socket.once('error', onError);
      session.socket.write(frameBuffer, () => {
        this.emitWebSocketEvent('websocket:session_written', {
          sessionId: session.id,
          frameType,
          byteLength:
            frameType === 'close'
              ? closeReason
                ? Buffer.byteLength(closeReason) + 2
                : closeCode
                  ? 2
                  : 0
              : payload.length,
          automatic: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: true,
          sessionId: session.id,
          kind: session.kind,
          scheme: session.scheme,
          frameType,
          bytesWritten: frameBuffer.length,
          payloadBytes:
            frameType === 'close'
              ? closeReason
                ? Buffer.byteLength(closeReason) + 2
                : closeCode
                  ? 2
                  : 0
              : payload.length,
          state: serializeWebSocketSessionState(session),
        });
      });
    });
  }

  protected async closeWebSocketSession(
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const session = this.websocketSessions.get(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown websocket sessionId "${sessionId}"` };
    }

    const force = argBool(args, 'force') ?? false;
    const timeoutMs = argNumber(args, 'timeoutMs') ?? 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const queuedFramesDiscarded = session.frames.length;
    if (session.closed || session.socket.destroyed) {
      this.websocketSessions.delete(sessionId);
      return {
        ok: true,
        sessionId,
        kind: session.kind,
        force,
        closed: true,
        queuedFramesDiscarded,
        state: serializeWebSocketSessionState(session),
      };
    }

    let closeCode: number | null = null;
    const rawCloseCode = argNumber(args, 'closeCode');
    if (rawCloseCode !== undefined) {
      if (!Number.isInteger(rawCloseCode) || rawCloseCode < 1000 || rawCloseCode > 4999) {
        return { ok: false, error: 'closeCode must be an integer between 1000 and 4999' };
      }
      closeCode = rawCloseCode;
    }
    const closeReason = argString(args, 'closeReason') ?? null;

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (closed: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('close', onClose);
        session.socket.off('error', onError);
        this.websocketSessions.delete(sessionId);
        this.emitWebSocketEvent('websocket:session_closed', {
          sessionId,
          reason: session.error,
          timestamp: new Date().toISOString(),
        });
        resolve({
          ok: true,
          sessionId,
          kind: session.kind,
          force,
          closed,
          queuedFramesDiscarded,
          state: serializeWebSocketSessionState(session),
        });
      };

      const onClose = (): void => finish(true);
      const onError = (): void => finish(session.socket.destroyed || session.closed);
      const timer = setTimeout(() => {
        session.socket.destroy();
        finish(session.socket.destroyed || session.closed);
      }, timeoutMs);

      session.socket.once('close', onClose);
      session.socket.once('error', onError);

      if (force) {
        session.socket.destroy();
        return;
      }

      if (!session.closeSent) {
        session.closeSent = true;
        session.socket.write(
          encodeWebSocketFrame('close', Buffer.alloc(0), closeCode, closeReason),
        );
        this.emitWebSocketEvent('websocket:session_written', {
          sessionId,
          frameType: 'close',
          byteLength: closeReason ? Buffer.byteLength(closeReason) + 2 : closeCode ? 2 : 0,
          automatic: false,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  async handleWebSocketSendFrame(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }
    const session = this.getWebSocketSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown websocket sessionId "${sessionId}"` };
    }
    return this.sendWebSocketFrame(session, args);
  }

  async handleWebSocketReadFrame(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }
    const session = this.getWebSocketSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown websocket sessionId "${sessionId}"` };
    }
    return this.readWebSocketFrame(session, args);
  }

  async handleWebSocketClose(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }
    return this.closeWebSocketSession(sessionId, args);
  }
}
