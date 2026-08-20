import { describe, expect, it } from 'vitest';

import { matchApkSurfaceHints } from '@modules/binary-instrument/apk-surface-hints';

describe('apk surface hints', () => {
  it('returns protector and SDK hints from one surface scan', () => {
    const entries = [
      'lib/arm64-v8a/libshell_loader.so',
      'assets/secondary.dat',
      'classes2.dex',
      'res/layout/webview.xml',
    ];
    const xml = [
      '<manifest>',
      '<uses-permission android:name="android.permission.INTERNET"/>',
      '<application android:name="com.example.ShellApplication">',
      '<service android:name="com.example.PushService"/>',
      '</application>',
      '</manifest>',
    ].join('\n');

    const hints = matchApkSurfaceHints(entries, xml);
    expect(hints.protectorHints.map((hint) => hint.name)).toEqual(
      expect.arrayContaining([
        'native-loader-surface',
        'secondary-code-container',
        'multi-dex-surface',
        'startup-wrapper-surface',
      ]),
    );
    expect(hints.sdkHints.map((hint) => hint.name)).toEqual(
      expect.arrayContaining([
        'network-permission-surface',
        'background-component-surface',
        'native-bridge-surface',
        'webview-surface',
      ]),
    );
  });

  it('matches caller-supplied literal hints case-insensitively', () => {
    const hints = matchApkSurfaceHints(['assets/EncryptedBlob.bin'], '', {
      customSurfaceHints: [
        { name: 'encrypted-asset-marker', patterns: ['encryptedblob'], kind: 'protector' },
      ],
    });

    expect(hints.protectorHints).toContainEqual({
      name: 'encrypted-asset-marker',
      evidence: ['assets/EncryptedBlob.bin'],
    });
  });
});
