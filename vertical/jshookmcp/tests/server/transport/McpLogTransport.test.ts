import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpLogTransport } from '@server/transport/McpLogTransport';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function createMockMcpServer() {
  const sendLoggingMessage = vi.fn().mockResolvedValue(undefined);
  return {
    server: {
      sendLoggingMessage,
    },
  };
}

describe('McpLogTransport', () => {
  let transport: McpLogTransport;

  beforeEach(() => {
    transport = new McpLogTransport();
  });

  it('silently ignores log calls before attach', () => {
    expect(() => {
      transport.info('test', { event: 'something' });
      transport.debug('test', { event: 'something' });
      transport.warning('test', { event: 'something' });
      transport.error('test', { event: 'something' });
    }).not.toThrow();
  });

  it('sends notification after attach when enabled', () => {
    const mock = createMockMcpServer();
    transport.attach(mock as never, true);

    transport.info('jshookmcp', { event: 'test_event' });

    expect(mock.server.sendLoggingMessage).toHaveBeenCalledTimes(1);
    expect(mock.server.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'info',
      logger: 'jshookmcp',
      data: JSON.stringify({ event: 'test_event' }),
    });
  });

  it('does not send notification when disabled', () => {
    const mock = createMockMcpServer();
    transport.attach(mock as never, false);

    transport.info('jshookmcp', { event: 'test_event' });

    expect(mock.server.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('respects log level ordering: debug < info < warning < error', () => {
    const mock = createMockMcpServer();
    transport.attach(mock as never, true);
    transport.setLevel('warning');

    transport.debug('test', { event: 'a' });
    transport.info('test', { event: 'b' });
    transport.warning('test', { event: 'c' });
    transport.error('test', { event: 'd' });

    expect(mock.server.sendLoggingMessage).toHaveBeenCalledTimes(2);
    expect(mock.server.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
    expect(mock.server.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('setLevel dynamically adjusts the minimum level', () => {
    const mock = createMockMcpServer();
    transport.attach(mock as never, true);
    transport.setLevel('info');

    transport.debug('test', { event: 'a' });
    expect(mock.server.sendLoggingMessage).not.toHaveBeenCalled();

    transport.setLevel('debug');
    transport.debug('test', { event: 'b' });
    expect(mock.server.sendLoggingMessage).toHaveBeenCalledTimes(1);
  });

  it('swallows sendLoggingMessage errors', () => {
    const mock = createMockMcpServer();
    mock.server.sendLoggingMessage.mockRejectedValue(new Error('transport broken'));
    transport.attach(mock as never, true);

    expect(() => {
      transport.info('test', { event: 'a' });
    }).not.toThrow();
  });

  it('convenience methods pass correct level', () => {
    const mock = createMockMcpServer();
    transport.attach(mock as never, true);
    transport.setLevel('debug');

    transport.debug('test', { event: '1' });
    transport.info('test', { event: '2' });
    transport.warning('test', { event: '3' });
    transport.error('test', { event: '4' });

    const calls = mock.server.sendLoggingMessage.mock.calls as Array<[{ level: string }]>;
    expect(calls[0]![0].level).toBe('debug');
    expect(calls[1]![0].level).toBe('info');
    expect(calls[2]![0].level).toBe('warning');
    expect(calls[3]![0].level).toBe('error');
  });

  it('setEnabled can toggle transport at runtime', () => {
    const mock = createMockMcpServer();
    transport.attach(mock as never, true);

    transport.info('test', { event: 'a' });
    expect(mock.server.sendLoggingMessage).toHaveBeenCalledTimes(1);

    transport.setEnabled(false);
    transport.info('test', { event: 'b' });
    expect(mock.server.sendLoggingMessage).toHaveBeenCalledTimes(1);

    transport.setEnabled(true);
    transport.info('test', { event: 'c' });
    expect(mock.server.sendLoggingMessage).toHaveBeenCalledTimes(2);
  });

  it('serializes data as JSON string in the data field', () => {
    const mock = createMockMcpServer();
    transport.attach(mock as never, true);

    const complexData = {
      event: 'tool_called',
      toolName: 'hook_fetch',
      nested: { key: [1, 2, 3] },
    };
    transport.info('jshookmcp', complexData);

    expect(mock.server.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: JSON.stringify(complexData),
      }),
    );
  });

  describe('file logging', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `jshookmcp-test-${Date.now()}`);
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('enableFileLogging creates a file stream and getFilePath returns path', () => {
      transport.enableFileLogging(tempDir);
      const filePath = transport.getFilePath();
      expect(filePath).toBeTruthy();
      expect(filePath).toContain('.log');
      expect(filePath).toContain('jshookmcp-');
    });

    it('getFilePath returns undefined when file logging is not enabled', () => {
      expect(transport.getFilePath()).toBeUndefined();
    });

    it('log() writes to file when file logging is enabled', () => {
      const mock = createMockMcpServer();
      transport.attach(mock as never, true);
      transport.enableFileLogging(tempDir);

      transport.info('test', { event: 'file_write_test' });

      const filePath = transport.getFilePath();
      expect(filePath).toBeTruthy();
      const contents = readFileSync(filePath!, 'utf8');
      expect(contents).toContain('"level":"info"');
      expect(contents).toContain('"logger":"test"');
      expect(contents).toContain('"event":"file_write_test"');
    });

    it('file log entries contain timestamp', () => {
      const mock = createMockMcpServer();
      transport.attach(mock as never, true);
      transport.enableFileLogging(tempDir);

      transport.info('test', { event: 'ts' });

      const contents = readFileSync(transport.getFilePath()!, 'utf8');
      const parsed = JSON.parse(contents.trim());
      expect(parsed.timestamp).toBeTruthy();
      expect(typeof parsed.timestamp).toBe('string');
    });

    it('enableFileLogging does not throw on invalid directory', () => {
      expect(() => {
        transport.enableFileLogging('/nonexistent/path/that/cannot/be/created');
      }).not.toThrow();
    });

    it('does not write to file when log level is below minimum', () => {
      const mock = createMockMcpServer();
      transport.attach(mock as never, true);
      transport.setLevel('warning');
      transport.enableFileLogging(tempDir);

      transport.debug('test', { event: 'should_not_write' });
      transport.info('test', { event: 'should_not_write_either' });

      const filePath = transport.getFilePath();
      if (existsSync(filePath!)) {
        const contents = readFileSync(filePath!, 'utf8');
        expect(contents).toBe('');
      }
    });
  });
});
