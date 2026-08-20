import { describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

import { CryptoDetector } from '@modules/crypto/CryptoDetector';

describe('CryptoDetector bug fixes', () => {
  it('turns a string versionPattern from JSON into a working RegExp', async () => {
    const detector = new CryptoDetector();
    detector.loadCustomRules(
      JSON.stringify({
        libraries: [
          {
            name: 'MyLib',
            patterns: ['mylib'],
            versionPattern: 'mylib\\.version\\s*=\\s*[\'"]([^\'"]+)[\'"]',
            confidence: 0.8,
          },
        ],
      }),
    );

    const result = await detector.detect({ code: 'mylib.version = "1.2.3";' } as any);
    const lib = result.libraries.find((l) => l.name === 'MyLib');
    expect(lib?.version).toBe('1.2.3');
  });

  it('keeps versionPattern usable across export/import roundtrips', () => {
    const detector = new CryptoDetector();
    const exported = JSON.parse(detector.exportRules());
    const cryptoJs = exported.libraries.find((l: { name: string }) => l.name === 'CryptoJS');
    expect(typeof cryptoJs?.versionPattern).toBe('string');

    // Roundtrip: the string form must reload into a working RegExp, not a
    // JSON-serialized {} or a raw string that silently never matches.
    const reloaded = new CryptoDetector();
    reloaded.loadCustomRules(JSON.stringify({ libraries: [cryptoJs] }));
  });

  it('accepts slash-delimited versionPattern strings with flags', async () => {
    const detector = new CryptoDetector();
    detector.loadCustomRules(
      JSON.stringify({
        libraries: [
          {
            name: 'FlaggedLib',
            patterns: ['flaggedlib'],
            versionPattern: '/flaggedlib@([0-9.]+)/i',
            confidence: 0.8,
          },
        ],
      }),
    );

    const result = await detector.detect({ code: 'flaggedlib@4.5.6' } as any);
    expect(result.libraries.find((l) => l.name === 'FlaggedLib')?.version).toBe('4.5.6');
  });

  it('classifies RC4 as an algorithm weakness, not an implementation one', async () => {
    const detector = new CryptoDetector();
    const result = await detector.detect({ code: 'const c = RC4.encrypt(x);' } as any);

    const rc4Issue = result.securityIssues?.find((i) => i.algorithm === 'RC4');
    expect(rc4Issue).toBeDefined();
    expect(result.strength?.factors.implementation).toBe(100);
    expect(result.strength?.factors.algorithm).toBeLessThan(100);
  });

  it('classifies padding issues into the implementation bucket, not mode', async () => {
    const detector = new CryptoDetector();
    const result = await detector.detect({
      code: 'CryptoJS.AES.encrypt("t", "k", { mode: "CBC", padding: "NoPadding" });',
    } as any);

    const paddingIssue = result.securityIssues?.find((i) => i.issue.includes('padding'));
    expect(paddingIssue).toBeDefined();
    expect(result.strength?.factors.mode).toBe(100);
    expect(result.strength?.factors.implementation).toBeLessThan(100);
  });
});
