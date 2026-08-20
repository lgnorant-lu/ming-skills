/**
 * Android runtime dump session handler.
 */

import { AndroidRuntimeDumpSessionManager } from '@modules/binary-instrument/android-runtime-dump-session';
import { ToolError } from '@errors/ToolError';
import type { BinaryInstrumentState } from './shared';
import { readOptionalString, readRequiredString, readOptionalNumber, jsonResponse } from './shared';

export class RuntimeDumpHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
  }

  async handleAndroidRuntimeDumpSession(args: Record<string, unknown>): Promise<unknown> {
    const action = readOptionalString(args, 'action') ?? 'start';
    const manager = this.getAndroidRuntimeDumpManager();
    if (action === 'start') {
      const outputDir = readRequiredString(args, 'outputDir');
      const packageName = readOptionalString(args, 'packageName');
      const pid = readOptionalNumber(args, 'pid');
      const mapsPath = readOptionalString(args, 'mapsPath');
      const maxDexFiles = readOptionalNumber(args, 'maxDexFiles');
      const maxDexFileBytes = readOptionalNumber(args, 'maxDexFileBytes');
      const maxTotalDexBytes = readOptionalNumber(args, 'maxTotalDexBytes');
      const maxMapsBytes = readOptionalNumber(args, 'maxMapsBytes');
      const maxMapsModules = readOptionalNumber(args, 'maxMapsModules');
      const session = await manager.start({
        ...(packageName ? { packageName } : {}),
        ...(pid !== undefined ? { pid } : {}),
        outputDir,
        ...(mapsPath ? { mapsPath } : {}),
        ...(maxDexFiles !== undefined ? { maxDexFiles } : {}),
        ...(maxDexFileBytes !== undefined ? { maxDexFileBytes } : {}),
        ...(maxTotalDexBytes !== undefined ? { maxTotalDexBytes } : {}),
        ...(maxMapsBytes !== undefined ? { maxMapsBytes } : {}),
        ...(maxMapsModules !== undefined ? { maxMapsModules } : {}),
      });
      const success = session.evidence.dumpedDex.count > 0;
      return jsonResponse({
        success,
        action,
        ...session,
        ...(!success ? { reason: 'No DEX/CDEX artifacts were indexed from outputDir.' } : {}),
      });
    }
    if (action === 'status') {
      const sessionId = readRequiredString(args, 'sessionId');
      const session = manager.status({ sessionId });
      if (!session) {
        return jsonResponse({
          success: false,
          action,
          sessionId,
          reason: `Unknown Android runtime dump session: ${sessionId}`,
        });
      }
      return jsonResponse({ success: true, action, ...session });
    }
    if (action === 'list') {
      const sessions = manager.list();
      return jsonResponse({ success: true, action, sessions, count: sessions.length });
    }
    throw new ToolError('VALIDATION', 'action must be one of: start, status, list');
  }

  private getAndroidRuntimeDumpManager(): AndroidRuntimeDumpSessionManager {
    if (!this.state.androidRuntimeDumpManager) {
      this.state.androidRuntimeDumpManager = new AndroidRuntimeDumpSessionManager();
    }
    return this.state.androidRuntimeDumpManager;
  }
}
