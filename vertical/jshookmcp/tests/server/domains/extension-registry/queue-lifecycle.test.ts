/**
 * Regression tests for the webhook CommandQueue lifecycle.
 *
 * Bugs:
 *  1. stopWebhookServer() cleared the handler's `commandQueue` field, but
 *     handleWebhookCommands() then created a FRESH queue — commands enqueued
 *     after a stop went to an instance no HTTP server would ever drain.
 *  2. getWebhookServer() created the queue as a side effect, while stop only
 *     cleared the reference — the queue's lifecycle was decoupled from the
 *     server's.
 *
 * Fix: the WebhookServer owns its CommandQueue (created in its constructor,
 * exposed via getCommandQueue()). The handler always enqueues through the
 * server's queue, so lifecycle and identity always match.
 *
 * These tests use the REAL WebhookServer/CommandQueue implementations (no
 * vi.mock for @server/webhook) — only the plugin registry is mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@modules/extension-registry', () => ({
  PluginRegistry: vi.fn(function (this: any) {
    this.listInstalled = vi.fn(() => []);
    this.loadPlugin = vi.fn();
    this.unloadPlugin = vi.fn();
    this.unregister = vi.fn();
  }),
  WebhookBridge: vi.fn(function (this: any) {
    this.registerExternalCallback = vi.fn();
    this.sendEvent = vi.fn(() => Promise.resolve(undefined));
  }),
}));

import { ExtensionRegistryHandlers } from '@server/domains/extension-registry/handlers.impl';

function parseBody(result: unknown) {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text);
}

describe('webhook CommandQueue lifecycle', () => {
  let handlers: ExtensionRegistryHandlers;

  beforeEach(() => {
    handlers = new ExtensionRegistryHandlers();
  });

  it('handleWebhookCommands enqueues into the server-owned queue', async () => {
    const result = await handlers.handleWebhookCommands({
      endpointId: 'ep-1',
      command: { type: 'ping' },
    });
    const body = parseBody(result);
    expect(body.success).toBe(true);
    expect(body.commandId).toBeDefined();

    // The same queue the server drains must hold the command.
    const serverQueue = handlers.getWebhookServer().getCommandQueue();
    const pending = serverQueue.dequeue({ endpointId: 'ep-1' });
    expect(pending).toHaveLength(1);
  });

  it('enqueues after stopWebhookServer land in the (re)created server queue, not an orphan', async () => {
    await handlers.startWebhookServer();
    await handlers.stopWebhookServer();

    const result = await handlers.handleWebhookCommands({
      endpointId: 'ep-x',
      command: { type: 'late' },
    });
    expect(parseBody(result).success).toBe(true);

    // The command must be reachable through the current server's queue —
    // never a detached queue that no server references.
    const serverQueue = handlers.getWebhookServer().getCommandQueue();
    const pending = serverQueue.dequeue({ endpointId: 'ep-x' });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload).toEqual({ type: 'late' });
  });

  it('stopWebhookServer releases the queue with the server (no dangling reference)', async () => {
    const firstServer = handlers.getWebhookServer();
    const firstQueue = firstServer.getCommandQueue();
    await handlers.stopWebhookServer();

    // A fresh server comes with a fresh queue.
    const secondServer = handlers.getWebhookServer();
    expect(secondServer).not.toBe(firstServer);
    expect(secondServer.getCommandQueue()).not.toBe(firstQueue);
  });

  it('WebhookServerImpl creates its own queue when none is injected', async () => {
    const server = handlers.getWebhookServer();
    expect(server.getCommandQueue()).toBeDefined();
  });
});
