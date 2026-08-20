import { describe, expect, it } from 'vitest';

import { LogcatLineCollector } from '@server/domains/adb-bridge/logcat';

describe('LogcatLineCollector', () => {
  it('filters across chunk boundaries and keeps only the requested tail', () => {
    const collector = new LogcatLineCollector({
      pid: '1234',
      pattern: /loader/i,
      maxLines: 2,
    });

    collector.pushChunk('06-10 I/App( 1234 ): loader sta');
    collector.pushChunk('rted\n06-10 I/App( 9999 ): loader ignored\n');
    collector.pushChunk('06-10 I/App( 1234 ): other ignored\n06-10 I/App( 1234 ): loader done\n');

    expect(collector.finish()).toEqual([
      '06-10 I/App( 1234 ): loader started',
      '06-10 I/App( 1234 ): loader done',
    ]);
  });

  it('uses package matching only when pid is absent', () => {
    const collector = new LogcatLineCollector({
      packageName: 'com.example',
      maxLines: 10,
    });

    collector.pushChunk('line for com.example\nline for other\n');
    expect(collector.finish()).toEqual(['line for com.example']);
  });
});
