/**
 * BoringsslInspectorRawSocketHandlers — stateless raw TCP/UDP helpers.
 */

import { createSocket as createUdpSocket } from 'node:dgram';
import { createServer as createNetServer, Socket as NetSocket } from 'node:net';
import { argNumber, argString } from '@server/domains/shared/parse-args';
import { normalizeHex, validateNetworkTarget } from './shared';
import { BoringsslInspectorWebSocketHandlers } from './websocket-handlers';

export class BoringsslInspectorRawSocketHandlers extends BoringsslInspectorWebSocketHandlers {
  async handleRawTcpSend(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) return ssrfCheck;

    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }

    const data = dataHex
      ? Buffer.from(normalizeHex(dataHex), 'hex')
      : Buffer.from(dataText ?? '', 'utf8');
    const timeout = argNumber(args, 'timeout') ?? 5000;

    return new Promise<unknown>((resolve) => {
      const socket = new NetSocket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      }, timeout);

      socket.on('connect', () => {
        socket.write(data, () => {
          socket.end();
        });
      });

      socket.on('data', (chunk: Buffer) => {
        clearTimeout(timer);
        resolve({
          ok: true,
          host,
          port,
          sentBytes: data.length,
          responseHex: chunk.toString('hex').toUpperCase(),
          responseText: chunk.toString('utf8'),
        });
        socket.destroy();
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      });

      socket.connect(port, host);
    });
  }

  async handleRawTcpListen(args: Record<string, unknown>): Promise<unknown> {
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const timeout = argNumber(args, 'timeout') ?? 10000;

    return new Promise<unknown>((resolve) => {
      const server = createNetServer();
      const timer = setTimeout(() => {
        server.close();
        resolve({ ok: false, error: 'Listen timed out - no connection received' });
      }, timeout);

      server.on('connection', (socket: NetSocket) => {
        clearTimeout(timer);
        const chunks: Buffer[] = [];

        socket.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        socket.on('end', () => {
          const data = Buffer.concat(chunks);
          server.close();
          resolve({
            ok: true,
            port,
            receivedBytes: data.length,
            dataHex: data.toString('hex').toUpperCase(),
            dataText: data.toString('utf8'),
          });
        });

        socket.on('error', (error: Error) => {
          clearTimeout(timer);
          server.close();
          resolve({ ok: false, error: error.message });
        });
      });

      server.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      });

      server.listen(port, '127.0.0.1');
    });
  }

  async handleRawUdpSend(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) return ssrfCheck;

    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }

    const data = dataHex
      ? Buffer.from(normalizeHex(dataHex), 'hex')
      : Buffer.from(dataText ?? '', 'utf8');
    const timeout = argNumber(args, 'timeout') ?? 5000;

    return new Promise<unknown>((resolve) => {
      const socket = createUdpSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        resolve({ ok: false, error: 'UDP response timed out' });
      }, timeout);

      socket.on('message', (msg: Buffer) => {
        clearTimeout(timer);
        socket.close();
        resolve({
          ok: true,
          host,
          port,
          sentBytes: data.length,
          responseHex: msg.toString('hex').toUpperCase(),
          responseText: msg.toString('utf8'),
        });
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: false, error: error.message });
      });

      socket.send(data, 0, data.length, port, host);
    });
  }

  async handleRawUdpListen(args: Record<string, unknown>): Promise<unknown> {
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const timeout = argNumber(args, 'timeout') ?? 10000;

    return new Promise<unknown>((resolve) => {
      const socket = createUdpSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        resolve({ ok: false, error: 'UDP listen timed out' });
      }, timeout);

      socket.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => {
        clearTimeout(timer);
        socket.close();
        resolve({
          ok: true,
          localPort: port,
          receivedBytes: msg.length,
          from: rinfo,
          dataHex: msg.toString('hex').toUpperCase(),
          dataText: msg.toString('utf8'),
        });
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: false, error: error.message });
      });
      socket.bind(port, '127.0.0.1');
    });
  }
}
