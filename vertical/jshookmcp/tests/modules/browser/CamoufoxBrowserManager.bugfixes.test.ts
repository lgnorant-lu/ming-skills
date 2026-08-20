import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CamoufoxBrowserManager } from '@modules/browser/CamoufoxBrowserManager';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
}));

const camoufoxLaunchMock = vi.hoisted(() => vi.fn());
const camoufoxServerLaunchMock = vi.hoisted(() => vi.fn());

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('camoufox-js', () => ({
  Camoufox: camoufoxLaunchMock,
  launchServer: camoufoxServerLaunchMock,
}));

describe('CamoufoxBrowserManager bug fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('close() also closes a running browser server', async () => {
    const server = {
      wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/x'),
      close: vi.fn(async () => {}),
    };
    camoufoxServerLaunchMock.mockResolvedValue(server);

    const manager = new CamoufoxBrowserManager();
    await manager.launchAsServer();

    await manager.close();

    expect(server.close).toHaveBeenCalled();
    expect(manager.getBrowserServerEndpoint()).toBeNull();
  });

  it('close() closes browser and server together when both are active', async () => {
    const browser = {
      newPage: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
    };
    const server = {
      wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/x'),
      close: vi.fn(async () => {}),
    };
    camoufoxLaunchMock.mockResolvedValue(browser);
    camoufoxServerLaunchMock.mockResolvedValue(server);

    const manager = new CamoufoxBrowserManager();
    await manager.launch();
    await manager.launchAsServer();

    await manager.close();

    expect(browser.close).toHaveBeenCalled();
    expect(server.close).toHaveBeenCalled();
  });
});
