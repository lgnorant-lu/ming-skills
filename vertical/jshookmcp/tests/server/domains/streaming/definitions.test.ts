import { describe, expect, it } from 'vitest';
import { streamingTools } from '@server/domains/streaming/definitions';

describe('streaming definitions', () => {
  const getTool = (name: string) => streamingTools.find((tool) => tool.name === name);

  it('keeps capture schema maximums aligned with runtime caps', async () => {
    const wsMonitor = getTool('ws_monitor');
    const sseMonitor = getTool('sse_monitor_enable');

    expect(wsMonitor?.inputSchema.properties?.maxFrames).toMatchObject({
      maximum: 20000,
    });
    expect(sseMonitor?.inputSchema.properties?.maxEvents).toMatchObject({
      maximum: 50000,
    });
  });
});
