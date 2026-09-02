/**
 * Content-level tests for generated hook preset bodies.
 *
 * Unlike preset-definitions.core.test.ts (which mocks buildHookCode),
 * these assert on the actual generated in-page JavaScript so regressions
 * in hook robustness (truncation, null guards, safe serialization) are
 * caught.
 */
import { describe, expect, it } from 'vitest';

import { CORE_PRESETS } from '@server/domains/instrumentation/hooks/preset-definitions.core';
import { SECURITY_PRESETS } from '@server/domains/instrumentation/hooks/preset-definitions.security';

describe('CORE_PRESETS — generated hook robustness', () => {
  it('btoa hook truncates output in the log message like atob does', () => {
    const code = CORE_PRESETS['atob-btoa']!.buildCode(true, true);
    expect(code).toContain("out=' + result.substring(0,100)");
    expect(code).not.toContain("' out=' + result;");
  });

  it('navigator-useragent guards against a null/undefined getter result', () => {
    const code = CORE_PRESETS['navigator-useragent']!.buildCode(true, true);
    expect(code).toContain("__result = (result == null ? '' : result)");
    expect(code).toContain('return result;');
  });

  it('postmessage serializes data defensively (circular-safe, single pass)', () => {
    const code = CORE_PRESETS['postmessage']!.buildCode(true, true);
    expect(code).toContain('__safeStr');
    expect(code).toContain('[unserializable]');
    expect(code).not.toContain('JSON.stringify(data).substring');
  });
});

describe('SECURITY_PRESETS — generated hook robustness', () => {
  it('crypto-key-capture records export failures instead of silent key:null', () => {
    const code = SECURITY_PRESETS['crypto-key-capture']!.buildCode(true, true);
    expect(code).toContain("fn:'export-failed'");
    expect(code).toContain('reason: String(e && e.message || e)');
  });
});
