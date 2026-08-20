import { describe, expect, it } from 'vitest';
import {
  getToolRequestContext,
  resolveToolRequestSessionId,
  runWithToolRequestContext,
} from '@server/runtime/ToolRequestContext';

describe('ToolRequestContext', () => {
  it('prefers the SDK session id and falls back to the HTTP session header', () => {
    expect(
      resolveToolRequestSessionId({
        sessionId: ' sdk-session ',
        requestInfo: { headers: { 'mcp-session-id': 'header-session' } },
      }),
    ).toBe('sdk-session');
    expect(
      resolveToolRequestSessionId({
        requestInfo: { headers: { 'mcp-session-id': [' ', 'header-session'] } },
      }),
    ).toBe('header-session');
    expect(resolveToolRequestSessionId({ _meta: { sessionId: 'meta-session' } })).toBe(
      'meta-session',
    );
  });

  it('keeps session and request identity across asynchronous work', async () => {
    await runWithToolRequestContext(
      { sessionId: 'session-a', requestId: 'request-a' },
      async () => {
        await Promise.resolve();
        expect(getToolRequestContext()).toEqual({
          sessionId: 'session-a',
          requestId: 'request-a',
        });
      },
    );
    expect(getToolRequestContext()).toBeNull();
  });
});
