import { asJsonResponse, serializeError } from '@server/domains/shared/response';
import {
  ReverseSessionOrchestrator,
  type ReverseSessionToolExecutor,
} from './ReverseSessionOrchestrator';

export class ReverseSessionHandlers {
  private readonly orchestrator: ReverseSessionOrchestrator;

  constructor(orchestratorOrExecutor?: ReverseSessionOrchestrator | ReverseSessionToolExecutor) {
    this.orchestrator =
      orchestratorOrExecutor instanceof ReverseSessionOrchestrator
        ? orchestratorOrExecutor
        : new ReverseSessionOrchestrator(undefined, orchestratorOrExecutor);
  }

  async handleReverseSession(args: Record<string, unknown>) {
    try {
      const action = readString(args, 'action') ?? 'create';
      if (action === 'create') {
        return asJsonResponse({
          success: true,
          action,
          session: this.orchestrator.create(readCreateInput(args)),
        });
      }
      if (action === 'plan') {
        return asJsonResponse({
          success: true,
          action,
          plan: this.orchestrator.plan(readCreateInput(args)),
        });
      }
      if (action === 'status') {
        const sessionId = requireString(args, 'sessionId');
        const session = this.orchestrator.status(sessionId);
        if (!session) {
          return asJsonResponse({
            success: false,
            action,
            sessionId,
            reason: `Unknown reverse session: ${sessionId}`,
          });
        }
        return asJsonResponse({ success: true, action, session });
      }
      if (action === 'list') {
        const sessions = this.orchestrator.list();
        return asJsonResponse({ success: true, action, sessions, count: sessions.length });
      }
      if (action === 'run') {
        return asJsonResponse({
          action,
          ...(await this.orchestrator.run(readRunInput(args))),
        });
      }
      throw new Error('action must be one of: create, status, list, plan, run');
    } catch (error) {
      return asJsonResponse({ tool: 'reverse_session', ...serializeError(error) });
    }
  }
}

function readCreateInput(args: Record<string, unknown>) {
  const platform = readString(args, 'platform');
  const packageName = readString(args, 'packageName');
  const apkPath = readString(args, 'apkPath');
  const artifactRoot = readString(args, 'artifactRoot');
  const pid =
    typeof args['pid'] === 'number' && Number.isFinite(args['pid']) ? args['pid'] : undefined;
  return {
    ...(platform ? { platform } : {}),
    ...(packageName ? { packageName } : {}),
    ...(apkPath ? { apkPath } : {}),
    ...(pid !== undefined ? { pid } : {}),
    ...(artifactRoot ? { artifactRoot } : {}),
  };
}

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = readString(args, key);
  if (!value) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function readRunInput(args: Record<string, unknown>) {
  const sessionId = requireString(args, 'sessionId');
  const maxSteps =
    typeof args['maxSteps'] === 'number' && Number.isFinite(args['maxSteps'])
      ? args['maxSteps']
      : undefined;
  const stopOnError = typeof args['stopOnError'] === 'boolean' ? args['stopOnError'] : undefined;
  const includeResults =
    typeof args['includeResults'] === 'boolean' ? args['includeResults'] : undefined;
  return {
    sessionId,
    ...(maxSteps !== undefined ? { maxSteps } : {}),
    ...(stopOnError !== undefined ? { stopOnError } : {}),
    ...(includeResults !== undefined ? { includeResults } : {}),
  };
}
