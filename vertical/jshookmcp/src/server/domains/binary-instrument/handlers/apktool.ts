/**
 * Apktool decode handler.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { probeCommand } from '@modules/external/ToolProbe';
import {
  readRequiredString,
  readOptionalString,
  readOptionalBoolean,
  jsonResponse,
  execFileUtf8,
} from './shared';

export class ApktoolHandlers {
  async handleApktoolDecode(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const explicitOutputDir = readOptionalString(args, 'outputDir');
    const force = readOptionalBoolean(args, 'force') ?? false;
    const apktoolProbe = await probeCommand('apktool', ['--version']);
    if (!apktoolProbe.available) {
      return jsonResponse({
        available: false,
        capability: 'apktool_cli',
        fix: 'Install apktool and ensure it is on PATH.',
        apkPath,
        reason: apktoolProbe.reason ?? 'apktool is not available',
      });
    }

    const outputDir = explicitOutputDir ?? join(tmpdir(), `jshook-apktool-${Date.now()}`);
    if (explicitOutputDir) {
      await mkdir(outputDir, { recursive: true });
    }

    try {
      const argsList = ['decode', '--output', outputDir];
      if (force) argsList.push('--force');
      argsList.push(apkPath);

      const result = await execFileUtf8(apktoolProbe.path ?? 'apktool', argsList, 120_000);
      return jsonResponse({
        available: true,
        apkPath,
        outputDir,
        force,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      });
    } catch (error) {
      return jsonResponse({
        available: true,
        apkPath,
        outputDir,
        force,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleApktoolBuild(args: Record<string, unknown>): Promise<unknown> {
    const sourceDir = readRequiredString(args, 'sourceDir');
    const outputPath = readOptionalString(args, 'outputPath');
    const force = readOptionalBoolean(args, 'force') ?? false;
    const apktoolProbe = await probeCommand('apktool', ['--version']);
    if (!apktoolProbe.available) {
      return jsonResponse({
        available: false,
        capability: 'apktool_cli',
        fix: 'Install apktool and ensure it is on PATH.',
        sourceDir,
        reason: apktoolProbe.reason ?? 'apktool is not available',
      });
    }

    try {
      const argsList = ['b', sourceDir];
      if (outputPath) {
        argsList.push('-o', outputPath);
      }
      if (force) {
        argsList.push('-f');
      }

      const result = await execFileUtf8(apktoolProbe.path ?? 'apktool', argsList, 180_000);
      return jsonResponse({
        available: true,
        sourceDir,
        outputPath: outputPath ?? null,
        force,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      });
    } catch (error) {
      return jsonResponse({
        available: true,
        sourceDir,
        outputPath: outputPath ?? null,
        force,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleApktoolSign(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const keystore = readOptionalString(args, 'keystore');
    const keystorePassword = readOptionalString(args, 'keystorePassword');
    const keyAlias = readOptionalString(args, 'keyAlias');
    const keyPassword = readOptionalString(args, 'keyPassword');
    const outputPath = readOptionalString(args, 'outputPath');
    const signerProbe = await probeCommand('apksigner', ['--version']);
    if (!signerProbe.available) {
      return jsonResponse({
        available: false,
        capability: 'apksigner',
        fix: 'Install Android build-tools and ensure apksigner is on PATH.',
        apkPath,
        reason: signerProbe.reason ?? 'apksigner is not available',
      });
    }

    // Signing requires a keystore; without one we honestly refuse rather than
    // silently producing an unsigned or debug-signed artifact.
    if (!keystore) {
      return jsonResponse({
        available: true,
        capability: 'apksigner',
        apkPath,
        signed: false,
        fix: 'Provide a keystore path (keystore) plus keystorePassword/keyAlias/keyPassword, or build a debug keystore with keytool first.',
      });
    }

    try {
      const argsList = ['sign', '--ks', keystore];
      if (keystorePassword) {
        argsList.push('--ks-pass', `pass:${keystorePassword}`);
      }
      if (keyAlias) {
        argsList.push('--ks-key-alias', keyAlias);
      }
      if (keyPassword) {
        argsList.push('--key-pass', `pass:${keyPassword}`);
      }
      if (outputPath) {
        argsList.push('--out', outputPath);
      }
      argsList.push(apkPath);

      const result = await execFileUtf8(signerProbe.path ?? 'apksigner', argsList, 180_000);
      return jsonResponse({
        available: true,
        apkPath,
        signed: true,
        outputPath: outputPath ?? null,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      });
    } catch (error) {
      return jsonResponse({
        available: true,
        apkPath,
        signed: false,
        outputPath: outputPath ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
