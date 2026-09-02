import {
  readEnvBoolean,
  readEnvInteger,
  readEnvNullableString,
  readEnvString,
} from '@src/config/environment';

export interface CrossDomainConfig {
  fridaEnabled: boolean;
  fridaServerHost: string;
  fridaServerPort: number;
  ghidraEnabled: boolean;
  ghidraHeadlessPath: string | null;
  unidbgEnabled: boolean;
  unidbgJarPath: string | null;
  etwEnabled: boolean;
  etwSessionName: string;
  mojoEnabled: boolean;
  mojoInterfaceRegistryPath: string | null;
  boringsslEnabled: boolean;
  boringsslCertPath: string | null;
  platform: string;
}

let cachedConfig: CrossDomainConfig | null = null;

function buildConfig(): CrossDomainConfig {
  const pathOptions = { trim: true } as const;
  const ghidraHeadlessPath = readEnvNullableString('GHIDRA_HEADLESS_PATH', pathOptions);
  const unidbgJarPath = readEnvNullableString('UNIDBG_JAR_PATH', pathOptions);
  const mojoInterfaceRegistryPath = readEnvNullableString(
    'MOJO_INTERFACE_REGISTRY_PATH',
    pathOptions,
  );
  const boringsslCertPath = readEnvNullableString('BORINGSSL_CERT_PATH', pathOptions);
  const platform = process.platform;

  return {
    fridaEnabled: readEnvBoolean('FRIDA_ENABLED', true),
    fridaServerHost: readEnvString('FRIDA_SERVER_HOST', '127.0.0.1', { trim: true }),
    fridaServerPort: readEnvInteger('FRIDA_SERVER_PORT', 27042, { min: 1, max: 65_535 }),
    ghidraEnabled: ghidraHeadlessPath !== null,
    ghidraHeadlessPath,
    unidbgEnabled: unidbgJarPath !== null,
    unidbgJarPath,
    etwEnabled: platform === 'win32',
    etwSessionName: readEnvString('ETW_SESSION_NAME', 'jshookmcp_etw', { trim: true }),
    mojoEnabled: readEnvBoolean('MOJO_ENABLED', true),
    mojoInterfaceRegistryPath,
    boringsslEnabled: readEnvBoolean('BORINGSSL_ENABLED', true),
    boringsslCertPath,
    platform,
  };
}

export function getCrossDomainConfig(): CrossDomainConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }
  cachedConfig = buildConfig();
  return cachedConfig;
}

/** Reset cached config — for testing only. */
export function resetConfigCache(): void {
  cachedConfig = null;
}
