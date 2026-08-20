/**
 * BoringsslInspectorBaseHandlers — shared state and transport helpers.
 */

import { TLSKeyLogExtractor } from '@modules/boringssl-inspector';
import { argBool, argNumber, argString } from '@server/domains/shared/parse-args';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import type {
  BufferedSession,
  SessionKind,
  SessionSocket,
  TcpSession,
  TlsSession,
  WebSocketSession,
} from './shared';
import {
  consumeSessionBuffer,
  isHex,
  normalizeHex,
  serializeSessionState,
  serializeSocketAddresses,
  waitForSessionActivity,
} from './shared';

export class BoringsslInspectorBaseHandlers {
  protected extensionInvoke?: (...args: unknown[]) => Promise<unknown>;
  protected eventBus?: EventBus<ServerEventMap>;
  protected readonly tcpSessions = new Map<string, TcpSession>();
  protected readonly tlsSessions = new Map<string, TlsSession>();
  protected readonly websocketSessions = new Map<string, WebSocketSession>();

  constructor(protected keyLogExtractor: TLSKeyLogExtractor = new TLSKeyLogExtractor()) {}

  setExtensionInvoke(invoke: (...args: unknown[]) => Promise<unknown>): void {
    this.extensionInvoke = invoke;
  }

  setEventBus(eventBus: EventBus<ServerEventMap>): void {
    this.eventBus = eventBus;
  }

  protected getTcpSession(sessionId: string): TcpSession | null {
    return this.tcpSessions.get(sessionId) ?? null;
  }

  protected getTlsSession(sessionId: string): TlsSession | null {
    return this.tlsSessions.get(sessionId) ?? null;
  }

  protected getWebSocketSession(sessionId: string): WebSocketSession | null {
    return this.websocketSessions.get(sessionId) ?? null;
  }

  protected parseWritePayload(
    args: Record<string, unknown>,
  ): { ok: true; data: Buffer; inputEncoding: 'hex' | 'utf8' } | { ok: false; error: string } {
    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');

    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }
    if (dataHex && dataText) {
      return { ok: false, error: 'dataHex and dataText are mutually exclusive' };
    }

    if (dataHex) {
      const normalized = normalizeHex(dataHex);
      if (!isHex(normalized)) {
        return { ok: false, error: 'dataHex must be valid even-length hexadecimal data' };
      }
      return {
        ok: true,
        data: Buffer.from(normalized, 'hex'),
        inputEncoding: 'hex',
      };
    }

    return {
      ok: true,
      data: Buffer.from(dataText ?? '', 'utf8'),
      inputEncoding: 'utf8',
    };
  }

  protected async writeBufferedSession(
    session: BufferedSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (session.socket.destroyed || session.closed) {
      return {
        ok: false,
        error: `Session "${session.id}" is already closed`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeSessionState(session),
      };
    }

    const payload = this.parseWritePayload(args);
    if (!payload.ok) {
      return { ok: false, error: payload.error, sessionId: session.id, kind: session.kind };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

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
          state: serializeSessionState(session),
        });
      }, timeoutMs);

      const onError = (error: Error): void => {
        finish({
          ok: false,
          error: error.message,
          sessionId: session.id,
          kind: session.kind,
          state: serializeSessionState(session),
        });
      };

      session.socket.once('error', onError);
      session.socket.write(payload.data, () => {
        if (session.kind === 'tcp') {
          void this.eventBus?.emit('tcp:session_written', {
            sessionId: session.id,
            byteLength: payload.data.length,
            timestamp: new Date().toISOString(),
          });
        } else {
          void this.eventBus?.emit('tls:session_written', {
            sessionId: session.id,
            byteLength: payload.data.length,
            timestamp: new Date().toISOString(),
          });
        }
        finish({
          ok: true,
          sessionId: session.id,
          kind: session.kind,
          inputEncoding: payload.inputEncoding,
          bytesWritten: payload.data.length,
          transport: serializeSocketAddresses(session.socket),
          state: serializeSessionState(session),
        });
      });
    });
  }

  protected async readBufferedSessionUntil(
    session: BufferedSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const delimiterHex = argString(args, 'delimiterHex');
    const delimiterText = argString(args, 'delimiterText');
    if (delimiterHex && delimiterText) {
      return { ok: false, error: 'delimiterHex and delimiterText are mutually exclusive' };
    }

    let delimiter: Buffer | null = null;
    if (delimiterHex) {
      const normalized = normalizeHex(delimiterHex);
      if (!isHex(normalized)) {
        return { ok: false, error: 'delimiterHex must be valid even-length hexadecimal data' };
      }
      delimiter = Buffer.from(normalized, 'hex');
    } else if (delimiterText !== undefined) {
      delimiter = Buffer.from(delimiterText, 'utf8');
    }

    if (delimiter && delimiter.length === 0) {
      return { ok: false, error: 'delimiter must not be empty' };
    }

    const includeDelimiter = argBool(args, 'includeDelimiter') ?? true;
    const rawMaxBytes = argNumber(args, 'maxBytes');
    const maxBytes = rawMaxBytes === undefined ? undefined : Math.trunc(rawMaxBytes);
    if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes <= 0)) {
      return { ok: false, error: 'maxBytes must be a positive integer when provided' };
    }
    if (!delimiter && maxBytes === undefined) {
      return { ok: false, error: 'delimiterHex, delimiterText, or maxBytes is required' };
    }

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
        state: serializeSessionState(session),
      };
    }

    session.activeRead = true;
    const startedAt = Date.now();

    try {
      while (true) {
        const consumed = consumeSessionBuffer(session, delimiter, includeDelimiter, maxBytes);
        if (consumed) {
          if (session.kind === 'tcp') {
            void this.eventBus?.emit('tcp:session_read', {
              sessionId: session.id,
              byteLength: consumed.data.length,
              matched: consumed.matchedDelimiter,
              timestamp: new Date().toISOString(),
            });
          } else {
            void this.eventBus?.emit('tls:session_read', {
              sessionId: session.id,
              byteLength: consumed.data.length,
              matched: consumed.matchedDelimiter,
              timestamp: new Date().toISOString(),
            });
          }
          return {
            ok: true,
            sessionId: session.id,
            kind: session.kind,
            bytesRead: consumed.data.length,
            matchedDelimiter: consumed.matchedDelimiter,
            stopReason: consumed.stopReason,
            delimiterHex: consumed.delimiterHex,
            dataHex: consumed.data.toString('hex').toUpperCase(),
            dataText: consumed.data.toString('utf8'),
            elapsedMs: Date.now() - startedAt,
            state: serializeSessionState(session),
          };
        }

        if (session.error) {
          return {
            ok: false,
            error: session.error,
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }

        if (session.ended || session.closed) {
          return {
            ok: false,
            error: 'socket closed before the requested read condition was satisfied',
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }

        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }

        const hadActivity = await waitForSessionActivity(session, remainingMs);
        if (!hadActivity) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }
      }
    } finally {
      session.activeRead = false;
    }
  }

  protected async closeBufferedSession<TSocket extends SessionSocket>(
    sessionId: string,
    sessions: Map<string, BufferedSession<TSocket>>,
    kind: SessionKind,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown ${kind} sessionId "${sessionId}"` };
    }

    const force = argBool(args, 'force') ?? false;
    const timeoutMs = argNumber(args, 'timeoutMs') ?? 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const bufferedBytesDiscarded = session.buffer.length;
    if (session.closed || session.socket.destroyed) {
      sessions.delete(sessionId);
      return {
        ok: true,
        sessionId,
        kind,
        force,
        closed: true,
        bufferedBytesDiscarded,
        state: serializeSessionState(session),
      };
    }

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
        sessions.delete(sessionId);
        if (kind === 'tcp') {
          void this.eventBus?.emit('tcp:session_closed', {
            sessionId,
            reason: session.error,
            timestamp: new Date().toISOString(),
          });
        } else {
          void this.eventBus?.emit('tls:session_closed', {
            sessionId,
            reason: session.error,
            timestamp: new Date().toISOString(),
          });
        }
        resolve({
          ok: true,
          sessionId,
          kind,
          force,
          closed,
          bufferedBytesDiscarded,
          state: serializeSessionState(session),
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

      session.socket.end();
    });
  }
}
