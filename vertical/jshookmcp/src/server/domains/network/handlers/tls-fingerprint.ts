import { sha256trunc12, toHex4, isGrease } from './fingerprint-utils';

const TLS_VERSION_MAP: Record<string, string> = {
  '0304': '13',
  '0303': '12',
  '0302': '11',
  '0301': '10',
  '0300': 's3',
  '0002': 's2',
  feff: 'd1',
  fefd: 'd2',
  fefc: 'd3',
};

function encodeTlsVersion(versionHex: string): string {
  return TLS_VERSION_MAP[versionHex.toLowerCase()] ?? '00';
}

function encodeAlpn(alpn: string): string {
  if (!alpn || alpn.length === 0) return '00';
  const first = alpn[0]!;
  const last = alpn[alpn.length - 1]!;
  const isFirstAlphaNum = /[0-9a-zA-Z]/.test(first);
  const isLastAlphaNum = /[0-9a-zA-Z]/.test(last);
  if (isFirstAlphaNum && isLastAlphaNum) return `${first}${last}`;
  const hex = Buffer.from(alpn, 'utf8').toString('hex');
  return `${hex[0] ?? '0'}${hex[hex.length - 1] ?? '0'}`;
}

export function computeTlsFingerprint(opts: {
  protocol: 'tls' | 'quic' | 'dtls';
  tlsVersion: string;
  hasSni: boolean;
  ciphers: string[];
  extensions: string[];
  signatureAlgorithms: string[];
  alpn: string;
}): { tls: string; tls_raw: string } {
  const { protocol, tlsVersion, hasSni, ciphers, extensions, signatureAlgorithms, alpn } = opts;

  const protoChar = protocol === 'quic' ? 'q' : protocol === 'dtls' ? 'd' : 't';

  // Use highest non-GREASE TLS version — sort ascending then take last
  const filteredVersions = [tlsVersion].map(toHex4).filter((v) => !isGrease(v) && v !== '0303');
  // Also include '0303' as baseline if no other version given
  const allVersions = tlsVersion.length > 0 ? filteredVersions : ['0303'];
  const sorted = allVersions.toSorted();
  const bestVersion = sorted.length > 0 ? sorted[sorted.length - 1]! : '0303';
  const versionStr = encodeTlsVersion(bestVersion);

  const sniChar = hasSni ? 'd' : 'i';

  const filteredCiphers = ciphers.map(toHex4).filter((c) => !isGrease(c));
  const filteredExts = extensions.map(toHex4).filter((e) => !isGrease(e));

  const numCiphers = String(Math.min(filteredCiphers.length, 99)).padStart(2, '0');
  const numExts = String(Math.min(filteredExts.length, 99)).padStart(2, '0');
  const alpnStr = encodeAlpn(alpn);

  const a = `${protoChar}${versionStr}${sniChar}${numCiphers}${numExts}${alpnStr}`;

  const sortedCiphers = filteredCiphers.toSorted();
  const cipherStr = sortedCiphers.join(',');
  const cipherHash = filteredCiphers.length > 0 ? sha256trunc12(cipherStr) : '000000000000';

  const extsForHash = filteredExts.filter((e) => e !== '0000' && e !== '0010').toSorted();
  // Signature algorithms are NOT GREASE-filtered, kept in original order
  const sigHex = signatureAlgorithms.map(toHex4);
  let extInput: string;
  if (sigHex.length > 0) {
    extInput = `${extsForHash.join(',')}_${sigHex.join(',')}`;
  } else {
    extInput = extsForHash.join(',');
  }
  const extHash =
    extsForHash.length > 0 || sigHex.length > 0 ? sha256trunc12(extInput) : '000000000000';

  const tls = `${a}_${cipherHash}_${extHash}`;

  const tls_raw = `${a}_${filteredCiphers.join(',')}_${filteredExts.join(',')}_${sigHex.join(',')}`;

  return { tls, tls_raw };
}
