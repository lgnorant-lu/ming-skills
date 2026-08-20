import { AdvancedHandlersBase } from '@server/domains/network/handlers.base';
import { ReplayHandlers } from '@server/domains/network/handlers/replay-handlers';

/**
 * Backward-compatible facade for the split replay handlers.
 *
 * The live implementations live in `handlers/replay-handlers.ts` (ReplayHandlers),
 * composed by `handlers.impl.ts`. This legacy class keeps the inheritance chain
 * (`AdvancedToolHandlersRuntime → Raw → Intercept`) working — exercised directly
 * by the runtime-replay tests — by delegating rather than duplicating the
 * auth-extraction / HAR-export / request-replay logic.
 */
export class AdvancedToolHandlersRuntime extends AdvancedHandlersBase {
  private replay: ReplayHandlers;

  constructor(...args: ConstructorParameters<typeof AdvancedHandlersBase>) {
    super(...args);
    this.replay = new ReplayHandlers({ consoleMonitor: this.consoleMonitor });
  }

  handleNetworkExtractAuth(args: Record<string, unknown>) {
    return this.replay.handleNetworkExtractAuth(args);
  }

  handleNetworkExportHar(args: Record<string, unknown>) {
    return this.replay.handleNetworkExportHar(args);
  }

  handleNetworkReplayRequest(args: Record<string, unknown>) {
    return this.replay.handleNetworkReplayRequest(args);
  }
}
