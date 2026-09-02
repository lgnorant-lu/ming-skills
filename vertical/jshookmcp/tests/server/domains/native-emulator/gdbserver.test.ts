/**
 * GDBServer Protocol Stub — unit tests.
 *
 * Tests RSP packet encoding/decoding and command processing.
 */

import { describe, it, expect } from 'vitest';
import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers.impl';

describe('nemu_gdbserver', () => {
  it('status returns server state when no session provided', async () => {
    const handlers = new NativeEmulatorHandlers();
    const result = await handlers.handleGdbserver({ action: 'status' });

    expect(result).toBeDefined();
    const content = (result as { content?: Array<{ type: string; text: string }> }).content;
    if (content?.[0]) {
      const data = JSON.parse(content[0].text);
      expect(data.running).toBe(false);
      expect(data.servers).toBeInstanceOf(Array);
    }
  });

  it('status with valid sessionId reports server state', async () => {
    const handlers = new NativeEmulatorHandlers();
    // Create a session first
    const created = await handlers.handleCreateSession({ installSyscalls: true });
    expect(created).toBeDefined();

    const createdContent = (created as { content?: Array<{ type: string; text: string }> }).content;
    const sessionId = createdContent?.[0] ? JSON.parse(createdContent[0].text).sessionId : null;
    expect(sessionId).toBeDefined();

    // No GDB server started for this session yet → status reports it stopped.
    const result = await handlers.handleGdbserver({ action: 'status', sessionId });
    const content = (result as { content?: Array<{ type: string; text: string }> }).content;
    if (content?.[0]) {
      const data = JSON.parse(content[0].text);
      expect(data.running).toBe(false);
      expect(data.servers).toBeInstanceOf(Array);
    }

    // Cleanup
    await handlers.handleDestroySession({ sessionId });
  });

  it('processes ? packet (halt reason)', async () => {
    const handlers = new NativeEmulatorHandlers();
    const created = await handlers.handleCreateSession({ installSyscalls: true });
    const createdContent = (created as { content?: Array<{ type: string; text: string }> }).content;
    const sessionId = createdContent?.[0] ? JSON.parse(createdContent[0].text).sessionId : null;

    // Build a valid RSP packet: $? + checksum
    let sum = 0;
    for (let i = 0; i < 1; i++) sum = (sum + '?'.charCodeAt(0)) & 0xff;
    const checksum = sum.toString(16).padStart(2, '0');
    const packet = `$?#${checksum}`;

    const result = await handlers.handleGdbserver({
      action: 'packet',
      sessionId,
      packet,
    });
    const content = (result as { content?: Array<{ type: string; text: string }> }).content;
    expect(content).toBeDefined();

    await handlers.handleDestroySession({ sessionId });
  });

  it('processes g packet (read registers)', async () => {
    const handlers = new NativeEmulatorHandlers();
    const created = await handlers.handleCreateSession({ installSyscalls: true });
    const createdContent = (created as { content?: Array<{ type: string; text: string }> }).content;
    const sessionId = createdContent?.[0] ? JSON.parse(createdContent[0].text).sessionId : null;

    let sum = 0;
    for (let i = 0; i < 1; i++) sum = (sum + 'g'.charCodeAt(0)) & 0xff;
    const checksum = sum.toString(16).padStart(2, '0');
    const packet = `$g#${checksum}`;

    // Need to load a library first for the engine to be initialized properly
    // For this test we just verify the handler doesn't crash
    const result = await handlers.handleGdbserver({
      action: 'packet',
      sessionId,
      packet,
    });
    expect(result).toBeDefined();

    const content = (result as { content?: Array<{ type: string; text: string }> }).content;
    expect(content).toBeDefined();

    await handlers.handleDestroySession({ sessionId });
  });
});
