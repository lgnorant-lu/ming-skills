/**
 * Unidbg ARM/ARM64 emulation handlers.
 */

import { UNIDBG_TIMEOUT_MS } from '@src/constants';
import type { BinaryInstrumentState } from './shared';
import {
  readRequiredString,
  readOptionalString,
  readStringArray,
  isRecord,
  textResponse,
  jsonResponse,
  getUnidbgAvailability,
  execFileUtf8,
} from './shared';

function parseUnidbgReturnValue(stdout: string): string | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.toReversed()) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) continue;
      const value = parsed['returnValue'] ?? parsed['retval'] ?? parsed['result'];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    } catch {
      // Non-JSON trace/log lines are parsed by the text fallback below.
    }
  }

  const textMatch = /\b(?:returnValue|retval|return|ret)[=:\s]+(0x[0-9a-fA-F]+|-?\d+)\b/i.exec(
    stdout,
  );
  return textMatch?.[1];
}

export class UnidbgHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
  }

  async handleUnidbgEmulate(args: Record<string, unknown>): Promise<unknown> {
    const binaryPath = readRequiredString(args, 'binaryPath');
    const functionName = readRequiredString(args, 'functionName');
    const invokeArgs = readStringArray(args, 'args');
    const availability = await getUnidbgAvailability();

    if (!availability.available) {
      return {
        success: false,
        available: false,
        capability: 'unidbg_jar',
        fix: 'Set UNIDBG_JAR to a reachable Unidbg JAR path.',
        binaryPath,
        functionName,
        args: invokeArgs,
        reason: availability.reason,
      };
    }

    const result = await execFileUtf8(
      availability.command,
      ['-jar', availability.jarPath, binaryPath, functionName, ...invokeArgs],
      UNIDBG_TIMEOUT_MS,
    );
    const returnValue = parseUnidbgReturnValue(result.stdout);

    return {
      success: true,
      available: true,
      binaryPath,
      functionName,
      args: invokeArgs,
      result: {
        ...(returnValue !== undefined ? { returnValue } : { returnValueKnown: false }),
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
        trace: [],
      },
    };
  }

  async handleUnidbgLaunch(args: Record<string, unknown>): Promise<unknown> {
    const soPath = readOptionalString(args, 'soPath');
    if (!soPath) return textResponse('Missing required string argument: soPath');
    const arch = readOptionalString(args, 'arch') ?? 'arm';

    try {
      const result = await this.state.unidbgRunner.launch(soPath, arch);
      return {
        available: true,
        sessionId: result.sessionId,
        soPath: result.soPath,
        arch: result.arch,
        sessions: this.state.unidbgRunner.listSessions(),
      };
    } catch (error) {
      return {
        available: false,
        capability: 'unidbg_jar',
        fix: 'Set UNIDBG_JAR to a reachable Unidbg JAR path and retry.',
        soPath,
        arch,
        reason: error instanceof Error ? error.message : String(error),
        sessions: this.state.unidbgRunner.listSessions(),
      };
    }
  }

  async handleUnidbgCall(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readOptionalString(args, 'sessionId');
    if (!sessionId) return textResponse('Missing required string argument: sessionId');
    const functionName = readOptionalString(args, 'functionName');
    if (!functionName) return textResponse('Missing required string argument: functionName');

    const callArgs = isRecord(args['args']) ? (args['args'] as Record<string, unknown>) : {};
    try {
      const result = await this.state.unidbgRunner.callFunction(sessionId, functionName, callArgs);
      return jsonResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return textResponse(
        message.startsWith('No unidbg session found') ? `${message} (not found)` : message,
      );
    }
  }

  async handleUnidbgTrace(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readOptionalString(args, 'sessionId');
    if (!sessionId) return textResponse('Missing required string argument: sessionId');

    try {
      const result = await this.state.unidbgRunner.trace(sessionId);
      return jsonResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return textResponse(
        message.startsWith('No unidbg session found') ? `${message} (not found)` : message,
      );
    }
  }
}
