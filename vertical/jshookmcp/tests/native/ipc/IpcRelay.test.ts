/**
 * IPC Relay — unit tests.
 *
 * Tests IpcRelay configuration, frame building, status reporting,
 * and relay registry operations. Network I/O is not exercised
 * (no real sockets).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IpcRelay,
  getOrCreateRelay,
  removeRelay,
  getRelayStatus,
  listRelays,
} from '@native/ipc/IpcRelay';

describe('IpcRelay', () => {
  describe('status', () => {
    it('reports sessionId and connected=false initially', () => {
      const relay = new IpcRelay({ sessionId: 'test-1' });
      const status = relay.status;
      expect(status.sessionId).toBe('test-1');
      expect(status.connected).toBe(false);
      expect(status.messagesSent).toBe(0);
      expect(status.messagesReceived).toBe(0);
    });

    it('reports correct transport for Windows', () => {
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        const relay = new IpcRelay({ sessionId: 'test-1' });
        expect(relay.status.transport).toBe('named-pipe');
      } finally {
        Object.defineProperty(process, 'platform', { value: original, configurable: true });
      }
    });

    it('reports correct transport for Linux', () => {
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      try {
        const relay = new IpcRelay({ sessionId: 'test-1' });
        expect(relay.status.transport).toBe('unix-socket');
      } finally {
        Object.defineProperty(process, 'platform', { value: original, configurable: true });
      }
    });
  });

  describe('path resolution', () => {
    it('resolves to a custom path when config.path is set', () => {
      const relay = new IpcRelay({
        sessionId: 'test-1',
        path: '/custom/path.sock',
      });
      expect(relay.status.path).toBe('/custom/path.sock');
    });

    it('resolves default named pipe path on Windows', () => {
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        const relay = new IpcRelay({ sessionId: 'abc-123' });
        expect(relay.status.path).toContain('jshookmcp_emu_abc-123');
        expect(relay.status.path).toContain('pipe');
      } finally {
        Object.defineProperty(process, 'platform', { value: original, configurable: true });
      }
    });

    it('resolves default Unix socket path on Linux', () => {
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      try {
        const relay = new IpcRelay({ sessionId: 'def-456' });
        expect(relay.status.path).toBe('/tmp/jshookmcp_emu_def-456.sock');
      } finally {
        Object.defineProperty(process, 'platform', { value: original, configurable: true });
      }
    });
  });

  describe('registry', () => {
    beforeEach(() => {
      // Clean up any leftover relays
      for (const s of listRelays()) {
        removeRelay(s.sessionId);
      }
    });

    it('getOrCreateRelay returns the same instance for same sessionId', () => {
      const r1 = getOrCreateRelay({ sessionId: 'registry-test' });
      const r2 = getOrCreateRelay({ sessionId: 'registry-test' });
      expect(r1).toBe(r2);
    });

    it('getOrCreateRelay returns different instances for different sessionIds', () => {
      const r1 = getOrCreateRelay({ sessionId: 'sess-a' });
      const r2 = getOrCreateRelay({ sessionId: 'sess-b' });
      expect(r1).not.toBe(r2);
    });

    it('removeRelay disconnects and removes from registry', () => {
      getOrCreateRelay({ sessionId: 'to-remove' });
      expect(removeRelay('to-remove')).toBe(true);
      expect(getRelayStatus('to-remove')).toBeNull();
    });

    it('removeRelay returns false for unknown sessionId', () => {
      expect(removeRelay('no-such')).toBe(false);
    });

    it('getRelayStatus returns null for unknown sessionId', () => {
      expect(getRelayStatus('no-such')).toBeNull();
    });

    it('listRelays returns all active relays', () => {
      getOrCreateRelay({ sessionId: 'list-a' });
      getOrCreateRelay({ sessionId: 'list-b' });
      const relays = listRelays();
      expect(relays.length).toBe(2);
      const ids = relays.map((r) => r.sessionId);
      expect(ids).toContain('list-a');
      expect(ids).toContain('list-b');
    });
  });

  describe('disconnect', () => {
    it('transitions connected to false and emits disconnected event', () => {
      const relay = new IpcRelay({ sessionId: 'disc-test' });
      let emitted = false;
      relay.on('disconnected', () => {
        emitted = true;
      });
      relay.disconnect();
      expect(relay.status.connected).toBe(false);
      expect(emitted).toBe(true);
    });
  });

  describe('security', () => {
    describe('path traversal (sessionId validation)', () => {
      it('rejects sessionId with path traversal (../)', () => {
        const relay = new IpcRelay({ sessionId: '../../etc/cron.d/evil' });
        expect(() => relay.status.path).toThrow(/Invalid sessionId/);
      });

      it('rejects sessionId with null bytes', () => {
        const relay = new IpcRelay({ sessionId: 'abc\x00def' });
        expect(() => relay.status.path).toThrow(/Invalid sessionId/);
      });

      it('accepts valid alphanumeric sessionIds with dots/dashes/underscores', () => {
        const relay = new IpcRelay({ sessionId: 'abc-123.test_ok' });
        expect(() => relay.status.path).not.toThrow();
      });

      it('rejects empty sessionId', () => {
        const relay = new IpcRelay({ sessionId: '' });
        expect(() => relay.status.path).toThrow(/Invalid sessionId/);
      });

      it('rejects sessionId starting with non-alphanumeric', () => {
        const relay = new IpcRelay({ sessionId: '-bad-start' });
        expect(() => relay.status.path).toThrow(/Invalid sessionId/);
      });
    });

    describe('buffer ceiling (DoS protection)', () => {
      it('destroys socket when receive buffer would exceed 2x maxMessageBytes', () => {
        const relay = new IpcRelay({ sessionId: 'buffer-test', maxMessageBytes: 1024 });
        // The MAX_BUFFER is 2 * maxMessageBytes = 2048.
        // Seed receiveBuffer with 2000 bytes, then send a 100-byte chunk → exceeds 2048.
        (relay as any).receiveBuffer = Buffer.alloc(2000);
        let destroyed = false;
        (relay as any).socket = {
          destroy: () => {
            destroyed = true;
          },
        };
        (relay as any).handleData(Buffer.alloc(100));
        expect(destroyed).toBe(true);
        expect((relay as any).lastError).toContain('Receive buffer exceeded');
      });

      it('does not destroy socket when buffer is within limit', () => {
        const relay = new IpcRelay({ sessionId: 'buffer-test-ok', maxMessageBytes: 1024 });
        (relay as any).receiveBuffer = Buffer.alloc(100);
        let destroyed = false;
        (relay as any).socket = {
          destroy: () => {
            destroyed = true;
          },
        };
        (relay as any).handleData(Buffer.alloc(100));
        expect(destroyed).toBe(false);
      });
    });

    describe('auth token plaintext warning', () => {
      it('warns when authToken is used with a remote host', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const relay = new IpcRelay({
            sessionId: 'auth-test',
            authToken: 'secret',
            host: '192.168.1.100',
          });
          // Access private buildFrame to trigger the check.
          (relay as any).buildFrame(1, 'test', {});
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[IpcRelay] authToken sent in plaintext'),
          );
        } finally {
          warnSpy.mockRestore();
        }
      });

      it('does not warn for localhost (127.0.0.1)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const relay = new IpcRelay({
            sessionId: 'auth-local',
            authToken: 'secret',
            host: '127.0.0.1',
          });
          (relay as any).buildFrame(1, 'test', {});
          expect(warnSpy).not.toHaveBeenCalled();
        } finally {
          warnSpy.mockRestore();
        }
      });

      it('does not warn when no authToken is set', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const relay = new IpcRelay({
            sessionId: 'no-auth',
            host: '10.0.0.1',
          });
          (relay as any).buildFrame(1, 'test', {});
          expect(warnSpy).not.toHaveBeenCalled();
        } finally {
          warnSpy.mockRestore();
        }
      });
    });
  });
});
