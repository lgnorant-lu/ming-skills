import {beforeEach, describe, expect, jest, test} from '@jest/globals';

jest.unstable_mockModule('../../../persistence.js', () => ({
  readAllPersistedSessions: jest.fn(async () => []),
  removePersistedSession: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../../../session-store.js', () => ({
  getDriver: jest.fn(),
  setSession: jest.fn(),
  getPlatformName: jest.fn(),
  isAndroidUiautomator2DriverSession: jest.fn(() => false),
  isRemoteDriverSession: jest.fn(() => false),
  isXCUITestDriverSession: jest.fn(() => false),
  PLATFORM: {ios: 'iOS', android: 'Android'},
}));

jest.unstable_mockModule('../../../command.js', () => ({
  execute: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../../../logger.js', () => ({
  default: {debug: () => {}, info: () => {}, warn: () => {}, error: () => {}},
}));

const {getDriver, getPlatformName, isRemoteDriverSession, isXCUITestDriverSession, PLATFORM} =
  await import('../../../session-store.js');
const {execute} = await import('../../../command.js');

const mockGetDriver = getDriver as jest.MockedFunction<typeof getDriver>;
const mockGetPlatformName = getPlatformName as jest.MockedFunction<typeof getPlatformName>;
const mockIsRemoteDriverSession = isRemoteDriverSession as jest.MockedFunction<typeof isRemoteDriverSession>;
const mockIsXCUITestDriverSession = isXCUITestDriverSession as jest.MockedFunction<typeof isXCUITestDriverSession>;
const mockExecute = execute as jest.MockedFunction<typeof execute>;

const mockServer = {addTool: jest.fn()} as any;

async function getToolExecute() {
  const {default: mobileDeviceControl} = await import('../../../tools/session/device-control.js');
  mobileDeviceControl(mockServer);
  return (mockServer.addTool as jest.MockedFunction<any>).mock.calls.at(-1)?.[0];
}

function textFromResult(result: {content: Array<{type: string; text?: string}>}): string | undefined {
  const block = result.content[0];
  return block && 'text' in block ? block.text : undefined;
}

describe('appium_mobile_device_control shake', () => {
  beforeEach(() => {
    mockGetDriver.mockReset();
    mockGetPlatformName.mockReset();
    mockIsRemoteDriverSession.mockReset();
    mockIsXCUITestDriverSession.mockReset();
    mockExecute.mockReset();
    mockIsRemoteDriverSession.mockReturnValue(false);
    mockIsXCUITestDriverSession.mockReturnValue(false);
  });

  test('remote iOS sessions use mobile: shake', async () => {
    const driver = {sessionId: 'remote-ios'};
    mockGetDriver.mockReturnValue(driver as any);
    mockGetPlatformName.mockReturnValue(PLATFORM.ios);
    mockIsRemoteDriverSession.mockReturnValue(true);

    const tool = await getToolExecute();
    const result = await tool.execute({action: 'shake'}, undefined);

    expect(result.isError).toBeFalsy();
    expect(textFromResult(result)).toBe('Shake action performed.');
    expect(mockExecute).toHaveBeenCalledWith(driver as never, 'mobile: shake', {});
  });

  test('embedded XCUITest sessions call mobileShake', async () => {
    const mobileShake = jest.fn(async () => {});
    const driver = {mobileShake};
    mockGetDriver.mockReturnValue(driver as any);
    mockGetPlatformName.mockReturnValue(PLATFORM.ios);
    mockIsXCUITestDriverSession.mockReturnValue(true);

    const tool = await getToolExecute();
    const result = await tool.execute({action: 'shake'}, undefined);

    expect(result.isError).toBeFalsy();
    expect(mobileShake).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('non-iOS platforms return a platform mismatch', async () => {
    mockGetDriver.mockReturnValue({sessionId: 'remote-android'} as any);
    mockGetPlatformName.mockReturnValue(PLATFORM.android);
    mockIsRemoteDriverSession.mockReturnValue(true);

    const tool = await getToolExecute();
    const result = await tool.execute({action: 'shake'}, undefined);

    expect(result.isError).toBe(true);
    expect(textFromResult(result)).toBe("action=shake is iOS-only. Current session platform is 'Android'.");
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
