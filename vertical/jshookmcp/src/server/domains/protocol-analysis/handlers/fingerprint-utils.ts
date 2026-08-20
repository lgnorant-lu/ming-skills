const TLS_RECORD_TYPES: Record<number, string> = {
  20: 'ChangeCipherSpec',
  21: 'Alert',
  22: 'Handshake',
  23: 'ApplicationData',
};

const TLS_VERSIONS: Record<string, string> = {
  '0300': 'SSL 3.0',
  '0301': 'TLS 1.0',
  '0302': 'TLS 1.1',
  '0303': 'TLS 1.2',
  '0304': 'TLS 1.3',
};

const TLS_CIPHER_NAMES: Record<string, string> = {
  '1301': 'TLS_AES_128_GCM_SHA256',
  '1302': 'TLS_AES_256_GCM_SHA384',
  '1303': 'TLS_CHACHA20_POLY1305_SHA256',
  c02b: 'TLS_ECDHE_ECDSA_AES_128_GCM_SHA256',
  c02f: 'TLS_ECDHE_RSA_AES_128_GCM_SHA256',
  c02c: 'TLS_ECDHE_ECDSA_AES_256_GCM_SHA384',
  c030: 'TLS_ECDHE_RSA_AES_256_GCM_SHA384',
  cca9: 'TLS_ECDHE_ECDSA_CHACHA20_POLY1305',
  cca8: 'TLS_ECDHE_RSA_CHACHA20_POLY1305',
  '009c': 'TLS_RSA_AES_128_GCM_SHA256',
  '009d': 'TLS_RSA_AES_256_GCM_SHA384',
  '002f': 'TLS_RSA_AES_128_CBC_SHA',
  '0035': 'TLS_RSA_AES_256_CBC_SHA',
  c013: 'TLS_ECDHE_RSA_AES_128_CBC_SHA',
  c014: 'TLS_ECDHE_RSA_AES_256_CBC_SHA',
  '00ff': 'TLS_EMPTY_RENEGOTIATION_INFO_SCSV',
  '5600': 'TLS_FALLBACK_SCSV',
};

const DNS_RCODES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

const DNS_OPTYPES: Record<number, string> = {
  0: 'QUERY',
  1: 'IQUERY',
  2: 'STATUS',
  3: 'UNASSIGNED',
  4: 'NOTIFY',
  5: 'UPDATE',
};

export const HTTP_METHODS: Record<string, string> = {
  '474554': 'GET',
  '504f5354': 'POST',
  '505554': 'PUT',
  '44454c45': 'DELETE',
  '48454144': 'HEAD',
  '50415443': 'PATCH',
  '4f505449': 'OPTIONS',
  '434f4e4e': 'CONNECT',
};

const TLS_EXTENSION_NAMES: Record<string, string> = {
  '0000': 'server_name',
  '000a': 'supported_groups',
  '000b': 'ec_point_formats',
  '000d': 'signature_algorithms',
  '0010': 'application_layer_protocol_negotiation',
  '0015': 'padding',
  '0017': 'extended_master_secret',
  '001b': 'compress_certificate',
  '0023': 'session_ticket',
  '0029': 'pre_shared_key',
  '002b': 'supported_versions',
  '002d': 'psk_key_exchange_modes',
  '0033': 'key_share',
  '0039': 'quic_transport_parameters',
  '4469': 'next_protocol_negotiation',
  fe0d: 'encrypted_client_hello',
  ff01: 'renegotiation_info',
};

export const WS_OPCODES: Record<number, string> = {
  0: 'continuation',
  1: 'text',
  2: 'binary',
  8: 'close',
  9: 'ping',
  10: 'pong',
};

export function readU8(hex: string, offset: number): number {
  return Number.parseInt(hex.substring(offset * 2, offset * 2 + 2), 16);
}

export function readU16(hex: string, offset: number): number {
  return Number.parseInt(hex.substring(offset * 2, offset * 2 + 4), 16);
}

function hexSlice(hex: string, offset: number, len: number): string {
  return hex.substring(offset * 2, (offset + len) * 2);
}

function isZeroedDnsHeader(hex: string): boolean {
  return hex.length >= 24 && /^0{24}$/i.test(hex.slice(0, 24));
}

export function parseTlsClientHello(hex: string): Record<string, unknown> | null {
  if (hex.length < 44) return null;
  const recordType = readU8(hex, 0);
  if (recordType !== 0x16) return null;
  const recordVersion = hexSlice(hex, 1, 2);
  const recordLen = readU16(hex, 3);
  if (hex.length / 2 < 5 + recordLen) return null;
  const hsType = readU8(hex, 5);
  if (hsType !== 0x01) return null;

  const result: Record<string, unknown> = {
    recordType: TLS_RECORD_TYPES[recordType] ?? `0x${recordType.toString(16)}`,
    recordVersion: TLS_VERSIONS[recordVersion] ?? recordVersion,
    recordLength: recordLen,
    handshakeType: 'ClientHello',
  };

  let pos = 9;
  if (pos + 2 > hex.length / 2) return result;
  const clientVersion = hexSlice(hex, pos, 2);
  result.clientVersion = TLS_VERSIONS[clientVersion] ?? clientVersion;
  pos += 34;

  if (pos >= hex.length / 2) return result;
  const sessionIdLen = readU8(hex, pos);
  pos += 1 + sessionIdLen;

  if (pos + 2 > hex.length / 2) return result;
  const cipherLen = readU16(hex, pos);
  pos += 2;
  const ciphers: Array<{ hex: string; name: string }> = [];
  for (let i = 0; i < cipherLen / 2 && pos + 2 <= hex.length / 2; i++) {
    const cipherHex = hexSlice(hex, pos, 2).toLowerCase();
    ciphers.push({
      hex: cipherHex,
      name: TLS_CIPHER_NAMES[cipherHex] ?? `Unknown(0x${cipherHex})`,
    });
    pos += 2;
  }
  result.cipherSuites = ciphers;
  result.cipherSuiteCount = ciphers.length;

  if (pos >= hex.length / 2) return result;
  const compLen = readU8(hex, pos);
  pos += 1 + compLen;

  if (pos + 2 > hex.length / 2) return result;
  const extTotalLen = readU16(hex, pos);
  pos += 2;
  const extEnd = pos + extTotalLen;
  const extensions: Array<{
    type: string;
    length: number;
    name?: string;
    details?: Record<string, unknown>;
  }> = [];
  while (pos + 4 <= extEnd && pos + 4 <= hex.length / 2) {
    const extType = hexSlice(hex, pos, 2).toLowerCase();
    const extLen = readU16(hex, pos + 2);
    const extBody = hexSlice(hex, pos + 4, extLen);
    const entry: {
      type: string;
      length: number;
      name?: string;
      details?: Record<string, unknown>;
    } = { type: extType, length: extLen, name: TLS_EXTENSION_NAMES[extType] };
    const details = parseTlsExtensionBody(extType, extBody);
    if (details) entry.details = details;
    extensions.push(entry);
    pos += 4 + extLen;
  }
  result.extensions = extensions;
  result.extensionCount = extensions.length;

  return result;
}

/**
 * Decode the body of a known TLS ClientHello extension into structured fields.
 * Returns null for unknown/unparseable extensions (the caller keeps the raw
 * type/length). Covers the high-value extensions a reverse engineer needs:
 * SNI (0x0000), ALPN (0x0010), supported_versions (0x002b),
 * signature_algorithms (0x000d), key_share (0x0033). Research #2 (dissect_tls),
 * delivered by deepening proto_fingerprint's TLS path.
 */
function parseTlsExtensionBody(type: string, body: string): Record<string, unknown> | null {
  try {
    if (type === '0000') {
      // SNI: server_name_list_len(2) + [name_type(1) + name_len(2) + name]
      if (body.length < 10) return null;
      const listLen = readU16(body, 0);
      if (listLen === 0) return null;
      const nameType = readU8(body, 2);
      const nameLen = readU16(body, 3);
      const hostname = hexToAscii(body.substring(10, 10 + nameLen * 2));
      return { kind: 'server_name', nameType, hostname };
    }
    if (type === '0010') {
      // ALPN: alpn_list_len(2) + [name_len(1) + name]+
      if (body.length < 4) return null;
      const listLen = readU16(body, 0);
      const protocols: string[] = [];
      let p = 2;
      while (p + 1 <= 2 + listLen && p < body.length / 2) {
        const l = readU8(body, p);
        protocols.push(hexToAscii(body.substring((p + 1) * 2, (p + 1 + l) * 2)));
        p += 1 + l;
      }
      return { kind: 'alpn', protocols };
    }
    if (type === '002b') {
      // supported_versions: list_len(1) + versions(2 each)
      if (body.length < 2) return null;
      const listLen = readU8(body, 0);
      const versions: string[] = [];
      for (let i = 0; i < listLen / 2 && 1 + i * 2 + 2 <= body.length / 2; i++) {
        const v = hexSlice(body, 1 + i * 2, 2);
        versions.push(TLS_VERSIONS[v] ?? v);
      }
      return { kind: 'supported_versions', versions };
    }
    if (type === '000d') {
      // signature_algorithms: list_len(2) + schemes(2 each)
      if (body.length < 4) return null;
      const listLen = readU16(body, 0);
      const schemes: string[] = [];
      for (let i = 0; i < listLen / 2 && 2 + i * 2 + 2 <= body.length / 2; i++) {
        schemes.push(hexSlice(body, 2 + i * 2, 2));
      }
      return { kind: 'signature_algorithms', schemeCount: schemes.length, schemes };
    }
    if (type === '0033') {
      // key_share (client): list_len(2) + [group(2) + key_len(2) + key]+
      if (body.length < 4) return null;
      const listLen = readU16(body, 0);
      const shares: Array<{ group: string; keyLength: number }> = [];
      let p = 2;
      while (p + 4 <= 2 + listLen && p + 4 <= body.length / 2) {
        const group = hexSlice(body, p, 2);
        const keyLen = readU16(body, p + 2);
        shares.push({ group, keyLength: keyLen });
        p += 4 + keyLen;
      }
      return { kind: 'key_share', shares };
    }
  } catch {
    return null;
  }
  return null;
}

function hexToAscii(hex: string): string {
  let out = '';
  for (let i = 0; i + 2 <= hex.length; i += 2) {
    const code = Number.parseInt(hex.substring(i, i + 2), 16);
    if (code >= 32 && code <= 126) out += String.fromCharCode(code);
  }
  return out;
}

export function parseDnsHeader(hex: string): Record<string, unknown> | null {
  if (hex.length < 24) return null;
  const txId = readU16(hex, 0);
  const flags1 = readU8(hex, 2);
  const flags2 = readU8(hex, 3);
  const qr = (flags1 >> 7) & 1;
  const opcode = (flags1 >> 3) & 0xf;
  const aa = (flags1 >> 2) & 1;
  const tc = (flags1 >> 1) & 1;
  const rd = flags1 & 1;
  const ra = (flags2 >> 7) & 1;
  const z = (flags2 >> 4) & 7;
  const rcode = flags2 & 0xf;

  return {
    transactionId: `0x${txId.toString(16).padStart(4, '0')}`,
    flags: {
      qr: qr === 1 ? 'Response' : 'Query',
      opcode: DNS_OPTYPES[opcode] ?? opcode,
      authoritativeAnswer: !!aa,
      truncation: !!tc,
      recursionDesired: !!rd,
      recursionAvailable: !!ra,
      reserved: z,
      responseCode: DNS_RCODES[rcode] ?? rcode,
    },
    questionCount: readU16(hex, 4),
    answerCount: readU16(hex, 6),
    authorityCount: readU16(hex, 8),
    additionalCount: readU16(hex, 10),
  };
}

export function isLikelyDnsHeader(hex: string): boolean {
  if (hex.length < 24 || isZeroedDnsHeader(hex)) return false;

  const flags1 = readU8(hex, 2);
  const flags2 = readU8(hex, 3);
  const qr = (flags1 >> 7) & 1;
  const opcode = (flags1 >> 3) & 0x0f;
  const rcode = flags2 & 0x0f;
  const qdcount = readU16(hex, 4);
  const ancount = readU16(hex, 6);

  if (opcode > 2) return false;
  if (qdcount + ancount === 0) return false;
  if (qr === 0 && rcode !== 0) return false;
  if (qr === 1 && rcode > 5) return false;

  return true;
}
