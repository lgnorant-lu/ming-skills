/**
 * Plugin bridge handler.
 */

import { getAvailablePlugins } from '@modules/binary-instrument';
import type { BinaryInstrumentState } from './shared';
import { jsonResponse } from './shared';

export class PluginBridgeHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
  }

  async handleGetAvailablePlugins(_args: Record<string, unknown>): Promise<unknown> {
    const plugins = this.state.context ? getAvailablePlugins(this.state.context) : [];
    return jsonResponse({ plugins, count: plugins.length });
  }
}
