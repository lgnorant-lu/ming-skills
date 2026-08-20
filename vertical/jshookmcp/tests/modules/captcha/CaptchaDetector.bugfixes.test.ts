import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { CaptchaDetector } from '@modules/captcha/CaptchaDetector';
import { CAPTCHA_SELECTORS } from '@modules/captcha/rules/selectors';

class TestDetector extends CaptchaDetector {
  public getSignalValuePublic(source: any, result: any) {
    return this.getSignalValue(source, result);
  }

  public checkPageTextPublic(page: any) {
    return this.checkPageText(page);
  }
}

describe('CaptchaDetector bug fixes', () => {
  it('getSignalValue handles null details without throwing', () => {
    const detector = new TestDetector();
    const value = detector.getSignalValuePublic('text', {
      type: 'unknown',
      detected: true,
      confidence: 90,
      details: null,
    });
    expect(value).toBe('unknown');
  });

  it('getSignalValue handles undefined and non-object details', () => {
    const detector = new TestDetector();
    expect(
      detector.getSignalValuePublic('text', {
        type: 'x',
        detected: true,
        confidence: 90,
        details: undefined,
      }),
    ).toBe('x');
    expect(
      detector.getSignalValuePublic('text', {
        type: 'x',
        detected: true,
        confidence: 90,
        details: 'a-string',
      }),
    ).toBe('x');
  });

  it('checkPageText tolerates a missing document.body', async () => {
    const detector = new TestDetector();
    const page = {
      evaluate: vi.fn(async () => undefined), // body null → evaluate returns undefined
    } as any;

    const result = await detector.checkPageTextPublic(page);
    expect(result.detected).toBe(false);
  });

  it('image selectors do not match every img with an alt attribute', () => {
    const imageSelectors = CAPTCHA_SELECTORS.image;
    // img[alt*=""] matches any element that merely HAS an alt attribute —
    // that would flag arbitrary images as captcha candidates.
    expect(imageSelectors).not.toContain('img[alt*=""]');
    expect(imageSelectors).toContain('img[alt*="captcha"]');
    expect(imageSelectors).toContain('img[src*="captcha"]');
  });
});
