import type { ConsoleMonitor } from '@server/domains/shared/modules/collector';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { applyEvaluationPostFilters } from '@server/domains/browser/handlers/evaluation-utils';

interface ConsoleHandlersDeps {
  consoleMonitor: ConsoleMonitor;
  detailedDataManager: DetailedDataManager;
}

export class ConsoleHandlers {
  constructor(private deps: ConsoleHandlersDeps) {}

  async handleConsoleMonitor(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const action = argString(args, 'action') as 'enable' | 'disable';
      if (action === 'enable') {
        await this.deps.consoleMonitor.enable();
        return { message: 'Console monitoring enabled' };
      }
      await this.deps.consoleMonitor.disable();
      return { message: 'Console monitoring disabled' };
    });
  }

  async handleConsoleGetLogs(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const type = argString(args, 'type') as NonNullable<
        Parameters<ConsoleMonitor['getLogs']>[0]
      >['type'];
      const limit = argNumber(args, 'limit') as number;
      const since = argNumber(args, 'since') as number;

      const logs = this.deps.consoleMonitor.getLogs({ type, limit, since });
      const result = this.deps.detailedDataManager.smartHandle({ count: logs.length, logs }, 51200);
      return result as Record<string, unknown>;
    });
  }

  async handleConsoleExecute(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const expression = argString(args, 'expression', '');
      const maxSize = argNumber(args, 'maxSize', 10485760);
      const stripBase64 = argBool(args, 'stripBase64', false);

      if (!expression.trim()) throw new Error('expression is required');

      const raw = await this.deps.consoleMonitor.execute(expression);
      const processed = applyEvaluationPostFilters(raw, this.deps.detailedDataManager, {
        autoSummarize: true,
        maxSize,
        stripBase64,
      });
      return { result: processed } as Record<string, unknown>;
    });
  }
}
