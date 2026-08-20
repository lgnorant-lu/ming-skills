/**
 * IDA Pro decompile handler.
 */

import type { BinaryInstrumentState } from './shared';
import { invokeLegacyPlugin } from './shared';

export class IdaHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
  }

  async handleIdaDecompile(args: Record<string, unknown>): Promise<unknown> {
    return invokeLegacyPlugin(this.state.context, 'plugin_ida_bridge', 'ida_decompile', args);
  }
}
