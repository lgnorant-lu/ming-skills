import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { SmartCodeCollector } from '@modules/collector/SmartCodeCollector';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('SmartCodeCollector bug fixes', () => {
  it('never splits a UTF-16 surrogate pair when truncating by maxFileSize', async () => {
    const collector = new SmartCodeCollector();
    // Build content where the truncation boundary falls between the two
    // surrogate halves of an emoji.
    const emoji = '😀'; // U+1F600 = 😀
    const content = 'x'.repeat(99) + emoji + 'y'.repeat(50);
    const files: any[] = [{ url: 'a.js', content, size: content.length, type: 'external' }];

    const result = (await collector.smartCollect({} as any, files, {
      mode: 'full',
      maxFileSize: 100,
    })) as any[];

    expect(result[0]?.content.length).toBeLessThanOrEqual(100);
    expect(LONE_SURROGATE.test(result[0]?.content ?? '')).toBe(false);
  });

  it('handles null/undefined file content without crashing', async () => {
    const collector = new SmartCodeCollector();
    const files: any[] = [
      { url: 'null.js', content: null, size: 10, type: 'external' },
      { url: 'undef.js', content: undefined, size: 10, type: 'external' },
    ];

    const result = (await collector.smartCollect({} as any, files, {
      mode: 'priority',
    })) as any[];

    expect(result.length).toBe(2);
    expect(result.every((f) => typeof f.content === 'string')).toBe(true);
  });

  it('summaries tolerate null content', async () => {
    const collector = new SmartCodeCollector();
    const files: any[] = [{ url: 's.js', content: null, size: 5, type: 'inline' }];

    const result = (await collector.smartCollect({} as any, files, {
      mode: 'summary',
    })) as any[];

    expect(result[0]?.preview).toBe('');
  });
});
