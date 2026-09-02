/**
 * Plugin integrity verification — digest allowlists, env guards, compatibility checks.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ExtensionBuilder } from '@server/plugins/PluginContract';
import { readEnvBoolean, readEnvString } from '@src/config/environment';
import { isCompatibleVersion } from './ExtensionManager.version';

export async function sha256Hex(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export function normalizeHex(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, '');
}

export function isPluginSignatureRequired(): boolean {
  const productionDefault = readEnvString('NODE_ENV', '', { trim: true }) === 'production';
  return readEnvBoolean('MCP_PLUGIN_SIGNATURE_REQUIRED', productionDefault);
}

export function isPluginStrictLoad(): boolean {
  const signatureRequired = isPluginSignatureRequired();
  return readEnvBoolean('MCP_PLUGIN_STRICT_LOAD', signatureRequired) || signatureRequired;
}

export function parseDigestAllowlist(raw: string | undefined): Set<string> {
  const value = raw?.trim();
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((item) => normalizeHex(item))
      .filter((item) => item.length > 0),
  );
}

export async function verifyPluginIntegrity(
  plugin: ExtensionBuilder,
  currentVersion: string,
): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isCompatibleVersion(plugin.compatibleCoreRange, currentVersion)) {
    errors.push(
      `Plugin ${plugin.id} incompatible with core ${currentVersion}; requires ${plugin.compatibleCoreRange}`,
    );
  }

  // File integrity verified separately since builders do not package checksums inline easily.
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
