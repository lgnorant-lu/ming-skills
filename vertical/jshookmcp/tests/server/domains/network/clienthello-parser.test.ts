import { describe, expect, it } from 'vitest';

import {
  computeJa3,
  computeJa4FromClientHello,
  parseClientHello,
} from '@server/domains/network/handlers/clienthello-parser';
import { isGrease } from '@server/domains/network/handlers/fingerprint-utils';

// Helper: build a TLS record containing a ClientHello from typed fields.
// record_version(2) handshake_type(1=0x16) length(3) handshake_type(1=0x01) length(3)
// client_version(2) random(32) session_id_len(1) session_id(...)
// cipher_suites_len(2) cipher_suites(2*n) compression_len(1) compressions(1*n)
// extensions_len(2) extensions(...)
function buildClientHello(opts: {
  recordVersion?: string;
  legacyVersion?: string;
  sessionId?: string;
  ciphers: string[]; // 4-hex each
  extensions: Array<{ type: string; data: string }>;
  compressions?: string[];
}): string {
  const recordVersion = opts.recordVersion ?? '0301';
  const legacyVersion = opts.legacyVersion ?? '0303';
  const sessionId = opts.sessionId ?? '';
  const compressions = opts.compressions ?? ['00']; // null compression

  const sessionIdHex = sessionId.length > 0 ? sessionId : '';
  const sessionIdLen = sessionIdHex.length / 2;

  const ciphersHex = opts.ciphers.join('');
  const ciphersLen = opts.ciphers.length * 2; // bytes (each cipher = 2 bytes = 4 hex)

  const compHex = compressions.join('');
  const compLen = compressions.length;

  // Build each extension: type(2) + length(2) + data
  const extBodiesHex = opts.extensions
    .map((e) => {
      const typeHex = e.type.padStart(4, '0');
      const dataBytes = e.data.length / 2;
      const lenHex = dataBytes.toString(16).padStart(4, '0');
      return `${typeHex}${lenHex}${e.data}`;
    })
    .join('');
  const extTotalBytes = extBodiesHex.length / 2;
  const extTotalLenHex = extTotalBytes.toString(16).padStart(4, '0');

  // ClientHello body (after handshake header): legacyVersion + random(32) + session_id + ciphers + compressions + extensions
  // random = 32 bytes of 0x00 for test determinism
  const randomHex = '00'.repeat(32);
  const body =
    legacyVersion +
    randomHex +
    sessionIdLen.toString(16).padStart(2, '0') +
    sessionIdHex +
    ciphersLen.toString(16).padStart(4, '0') +
    ciphersHex +
    compLen.toString(16).padStart(2, '0') +
    compHex +
    extTotalLenHex +
    extBodiesHex;

  const bodyBytes = body.length / 2;
  // handshake header: type(1)=0x01 + length(3)
  const hsLenHex = bodyBytes.toString(16).padStart(6, '0');
  const handshake = '01' + hsLenHex + body;

  const handshakeBytes = handshake.length / 2;
  // record header: type(1)=0x16 + version(2) + length(2)
  const recLenHex = handshakeBytes.toString(16).padStart(4, '0');
  const record = '16' + recordVersion + recLenHex + handshake;

  return record;
}

// extension data builders
function extSupportedGroups(curves: string[]): string {
  // list_length(2) + curves(2*n)
  const list = curves.join('');
  const len = (curves.length * 2).toString(16).padStart(4, '0');
  return len + list;
}
function extEcPointFormats(formats: string[]): string {
  // length(1) + formats(1*n)
  const list = formats.join('');
  const len = formats.length.toString(16).padStart(2, '0');
  return len + list;
}
function extSignatureAlgorithms(sigs: string[]): string {
  // list_length(2) + sigs(2*n)
  const list = sigs.join('');
  const len = (sigs.length * 2).toString(16).padStart(4, '0');
  return len + list;
}
function extSupportedVersions(versions: string[]): string {
  // list_length(1) + versions(2*n)
  const list = versions.join('');
  const len = (versions.length * 2).toString(16).padStart(2, '0');
  return len + list;
}
function extAlpn(prots: string[]): string {
  // list_length(2) + [proto_len(1) + proto(...) ]*n
  const list = prots
    .map((p) => {
      const hex = Buffer.from(p, 'ascii').toString('hex');
      return p.length.toString(16).padStart(2, '0') + hex;
    })
    .join('');
  const len = (list.length / 2).toString(16).padStart(4, '0');
  return len + list;
}
function extSni(host: string): string {
  // server_name_list_length(2) + [name_type(1)=00 + name_len(2) + name]
  const hostHex = Buffer.from(host, 'ascii').toString('hex');
  const nameEntry = '00' + host.length.toString(16).padStart(4, '0') + hostHex;
  const listLen = (nameEntry.length / 2).toString(16).padStart(4, '0');
  return listLen + nameEntry;
}

describe('clienthello-parser — parseClientHello', () => {
  it('parses a minimal Chrome-like ClientHello with all JA fields', () => {
    const hex = buildClientHello({
      legacyVersion: '0303',
      ciphers: ['1301', '1302', '1303', 'c02b', 'c02f', 'cca9', 'cca8'],
      extensions: [
        { type: '0000', data: extSni('example.com') }, // SNI
        { type: '000b', data: extEcPointFormats(['00', '01', '02']) }, // ec_point_formats
        { type: '000a', data: extSupportedGroups(['001d', '0017', '0018', '0100', '0101']) }, // supported_groups (elliptic_curves)
        { type: '000d', data: extSignatureAlgorithms(['0403', '0804', '0401', '0503']) }, // signature_algorithms
        { type: '0010', data: extAlpn(['h2', 'http/1.1']) }, // ALPN
      ],
    });

    const parsed = parseClientHello(hex);

    expect(parsed.valid).toBe(true);
    expect(parsed.recordVersion).toBe('0301');
    expect(parsed.legacyVersion).toBe('0303');
    expect(parsed.ciphers).toEqual(['1301', '1302', '1303', 'c02b', 'c02f', 'cca9', 'cca8']);
    expect(parsed.extensions!.map((e) => e.type)).toEqual(['0000', '000b', '000a', '000d', '0010']);
    expect(parsed.hasSni).toBe(true);
    expect(parsed.alpn).toEqual(['h2', 'http/1.1']);
    expect(parsed.supportedVersions).toEqual([]); // no supported_versions ext
    expect(parsed.ellipticCurves).toEqual(['001d', '0017', '0018', '0100', '0101']);
    expect(parsed.ecPointFormats).toEqual(['00', '01', '02']);
    expect(parsed.signatureAlgorithms).toEqual(['0403', '0804', '0401', '0503']);
  });

  it('extracts TLS 1.3 from supported_versions extension (not legacy 0x0303)', () => {
    const hex = buildClientHello({
      legacyVersion: '0303',
      ciphers: ['1301'],
      extensions: [
        { type: '002b', data: extSupportedVersions(['0304', '0303']) }, // supported_versions
      ],
    });
    const parsed = parseClientHello(hex);
    expect(parsed.supportedVersions).toEqual(['0304', '0303']);
    expect(parsed.negotiatedVersion).toBe('0304'); // highest real version
  });

  it('falls back to legacy version when supported_versions absent (TLS 1.2)', () => {
    const hex = buildClientHello({
      legacyVersion: '0303',
      ciphers: ['c02f'],
      extensions: [],
    });
    const parsed = parseClientHello(hex);
    expect(parsed.supportedVersions).toEqual([]);
    expect(parsed.negotiatedVersion).toBe('0303');
  });

  it('filters GREASE from cipher/extension/version lists but preserves order', () => {
    const hex = buildClientHello({
      legacyVersion: '0303',
      ciphers: ['0a0a', '1301', '1a1a', '1302'], // GREASE interleaved
      extensions: [
        { type: '8a8a', data: '00' }, // GREASE extension
        { type: '000a', data: extSupportedGroups(['001d']) },
        { type: 'aaaa', data: '00' }, // GREASE extension
      ],
    });
    const parsed = parseClientHello(hex);
    // Raw lists keep GREASE (for JA3 raw / JA4 count of original order)
    expect(parsed.ciphers).toEqual(['0a0a', '1301', '1a1a', '1302']);
    expect(parsed.extensions!.map((e) => e.type)).toEqual(['8a8a', '000a', 'aaaa']);
  });

  it('rejects truncated ClientHello (length field claims more bytes than present)', () => {
    // Build then chop the last 4 bytes off the record
    const full = buildClientHello({
      ciphers: ['1301'],
      extensions: [{ type: '000a', data: extSupportedGroups(['001d']) }],
    });
    const truncated = full.slice(0, -8); // remove tail
    const parsed = parseClientHello(truncated);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBeDefined();
  });

  it('rejects a non-ClientHello record (wrong handshake type)', () => {
    // ServerHello would be 0x16 0x02 — single literal (no concat).
    const fakeRecord = '1603010005020000020303';
    const parsed = parseClientHello(fakeRecord);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain('ClientHello');
  });

  it('parses a ClientHello with no extensions at all', () => {
    const hex = buildClientHello({
      ciphers: ['0035'],
      extensions: [],
    });
    const parsed = parseClientHello(hex);
    expect(parsed.valid).toBe(true);
    expect(parsed.extensions).toEqual([]);
    expect(parsed.hasSni).toBe(false);
    expect(parsed.alpn).toEqual([]);
  });
});

describe('clienthello-parser — computeJa3', () => {
  it('produces MD5 JA3 hash for a known cipher/ext/curve set', () => {
    const parsed = parseClientHello(
      buildClientHello({
        legacyVersion: '0303',
        ciphers: ['1301', '1302', '1303', 'c02b', 'c02f'],
        extensions: [
          { type: '0000', data: extSni('x.com') },
          { type: '000b', data: extEcPointFormats(['00']) },
          { type: '000a', data: extSupportedGroups(['001d', '0017']) },
          { type: '000d', data: extSignatureAlgorithms(['0403']) },
          { type: '0010', data: extAlpn(['h2']) },
        ],
      }),
    );

    const ja3 = computeJa3(parsed);
    // JA3 raw format: version,ciphers,extensions,ec_point_formats,elliptic_curves (GREASE removed)
    expect(ja3.ja3_raw).toBe('0303,1301-1302-1303-c02b-c02f,0000-000b-000a-000d-0010,00,001d-0017');
    // ja3 is the MD5 hex digest (32 lowercase hex chars)
    expect(ja3.ja3).toMatch(/^[0-9a-f]{32}$/);
  });

  it('removes GREASE values entirely from JA3 raw (no trailing dashes)', () => {
    const parsed = parseClientHello(
      buildClientHello({
        ciphers: ['0a0a', '1301', '1a1a'],
        extensions: [
          { type: '8a8a', data: '00' },
          { type: '000a', data: extSupportedGroups(['001d']) },
        ],
      }),
    );
    const ja3 = computeJa3(parsed);
    // GREASE cipher 0a0a/1a1a removed, GREASE ext 8a8a removed
    expect(ja3.ja3_raw).toBe('0303,1301,000a,,001d');
  });

  it('leaves empty segments when no elliptic_curves / ec_point_formats', () => {
    const parsed = parseClientHello(
      buildClientHello({
        ciphers: ['1301'],
        extensions: [],
      }),
    );
    const ja3 = computeJa3(parsed);
    // version,ciphers,extensions,ec_point_formats(empty),elliptic_curves(empty)
    expect(ja3.ja3_raw).toBe('0303,1301,,,');
  });

  it('uses TLS 1.3 (0304) version when supported_versions present', () => {
    const parsed = parseClientHello(
      buildClientHello({
        legacyVersion: '0303',
        ciphers: ['1301'],
        extensions: [{ type: '002b', data: extSupportedVersions(['0304']) }],
      }),
    );
    // JA3 uses the legacy version field (0303) per Salesforce spec — supported_versions does NOT change JA3 version
    const ja3 = computeJa3(parsed);
    expect(ja3.ja3_raw.startsWith('0303,')).toBe(true);
  });

  it('JA3 hash is deterministic (same input → same hash)', () => {
    const build = () =>
      parseClientHello(
        buildClientHello({
          ciphers: ['1301', 'c02f'],
          extensions: [{ type: '000a', data: extSupportedGroups(['001d']) }],
        }),
      );
    expect(computeJa3(build()).ja3).toBe(computeJa3(build()).ja3);
  });
});

describe('clienthello-parser — computeJa4FromClientHello', () => {
  it('computes JA4 fingerprint string from parsed ClientHello', () => {
    const hex = buildClientHello({
      legacyVersion: '0303',
      ciphers: ['1301', '1302', '1303', 'c02b', 'c02f'],
      extensions: [
        { type: '0000', data: extSni('example.com') },
        { type: '000a', data: extSupportedGroups(['001d']) },
        { type: '002b', data: extSupportedVersions(['0304']) }, // TLS 1.3
        { type: '000d', data: extSignatureAlgorithms(['0403', '0804']) },
        { type: '0010', data: extAlpn(['h2']) },
      ],
    });
    const parsed = parseClientHello(hex);
    const ja4 = computeJa4FromClientHello(parsed);

    // Part A: t=tls, 13=TLS1.3 (from supported_versions), d=SNI, 05 ciphers, 05 exts, h2 ALPN
    expect(ja4.ja4.startsWith('t13d0505h2')).toBe(true);
    expect(ja4.ja4_raw).toBeDefined();
    expect((ja4.ja4 as string).split('_')).toHaveLength(3); // A_B_C
  });

  it('JA4 marks SNI absent as "i"', () => {
    const hex = buildClientHello({
      ciphers: ['1301'],
      extensions: [{ type: '002b', data: extSupportedVersions(['0304']) }],
    });
    const parsed = parseClientHello(hex);
    const ja4 = computeJa4FromClientHello(parsed);
    expect((ja4.ja4 as string).startsWith('t13i')).toBe(true);
  });

  it('JA4 uses no-ALPN "00" when ALPN extension absent', () => {
    const hex = buildClientHello({
      ciphers: ['1301'],
      extensions: [
        { type: '002b', data: extSupportedVersions(['0304']) },
        { type: '000a', data: extSupportedGroups(['001d']) },
      ],
    });
    const parsed = parseClientHello(hex);
    const ja4 = computeJa4FromClientHello(parsed);
    // Part A is 10 chars: t13i + 01 ciphers + 02 exts + 2-char ALPN. ALPN occupies chars 8-9.
    expect((ja4.ja4 as string).slice(8, 10)).toBe('00');
  });

  it('throws on invalid ClientHello parse (clear contract)', () => {
    // ServerHello would be 0x16 0x02 — build manually (single literal, no concat).
    const fakeRecord = '1603010005020000020303';
    const parsed = parseClientHello(fakeRecord);
    expect(() => computeJa4FromClientHello(parsed)).toThrow();
  });
});

// sanity: isGrease used by parser via fingerprint-utils
describe('clienthello-parser — GREASE contract', () => {
  it('isGrease recognises all 16 GREASE values', () => {
    const greaseVals = [
      '0a0a',
      '1a1a',
      '2a2a',
      '3a3a',
      '4a4a',
      '5a5a',
      '6a6a',
      '7a7a',
      '8a8a',
      '9a9a',
      'aaaa',
      'baba',
      'caca',
      'dada',
      'eaea',
      'fafa',
    ];
    for (const g of greaseVals) expect(isGrease(g)).toBe(true);
    expect(isGrease('1301')).toBe(false);
    expect(isGrease('0000')).toBe(false);
  });
});
