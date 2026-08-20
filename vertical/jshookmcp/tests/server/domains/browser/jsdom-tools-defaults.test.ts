import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

/**
 * Verify that JsdomHandlers applies the same arg defaults as the tool schema
 * (definitions.tools.jsdom.ts). The handler default previously drifted from the
 * schema default for storageQuotaBytes (1_000_000 vs 5_000_000).
 */

const jsdomConstructorMock = vi.fn();

vi.mock('jsdom', () => ({
  JSDOM: class {
    window: Record<string, unknown>;
    constructor(html: string, options: unknown) {
      jsdomConstructorMock(html, options);
      this.window = {
        document: {
          title: '',
          getElementsByTagName: () => [],
          querySelectorAll: () => [],
        },
        close: vi.fn(),
      };
    }
    serialize(): string {
      return '';
    }
    nodeLocation(): null {
      return null;
    }
  },
}));

import { JsdomHandlers } from '@server/domains/browser/handlers/jsdom-tools';

describe('JsdomHandlers arg defaults (schema parity)', () => {
  let handlers: JsdomHandlers | null = null;

  afterEach(() => {
    handlers?.closeAll();
    handlers = null;
    jsdomConstructorMock.mockClear();
  });

  it('applies the schema default storageQuotaBytes (5_000_000) when omitted', async () => {
    handlers = new JsdomHandlers();
    const resp = parseJson<{ success: boolean; sessionId: string }>(
      await handlers.handleJsdomParse({ html: '<p>x</p>' }),
    );
    expect(resp.success).toBe(true);

    const [, options] = jsdomConstructorMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.storageQuota).toBe(5_000_000);
  });

  it('honors an explicit storageQuotaBytes argument', async () => {
    handlers = new JsdomHandlers();
    await handlers.handleJsdomParse({ html: '<p>x</p>', storageQuotaBytes: 123_456 });

    const [, options] = jsdomConstructorMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.storageQuota).toBe(123_456);
  });
});
