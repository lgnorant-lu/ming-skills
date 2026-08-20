import { describe, expect, it, vi } from 'vitest';
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';

// DNS payloads hand-built per RFC 1035. All hex is big-endian (network order).
//
// QNAME for "example.com": 07 65 78 61 6d 70 6c 65 03 63 6f 6d 00
const EXAMPLE_COM_QNAME = '076578616d706c6503636f6d00';
// QNAME for "www.example.com": 03 77 77 77 07 65 78 61 6d 70 6c 65 03 63 6f 6d 00
const WWW_EXAMPLE_COM_QNAME = '03777777076578616d706c6503636f6d00';

describe('ProtocolAnalysisHandlers — handleProtoDissectDns', () => {
  const eventBus = { emit: vi.fn() } as any;
  const handlers = new ProtocolAnalysisHandlers(undefined, undefined, eventBus);

  it('decodes a standard A query for example.com', async () => {
    // ID=0x1234, flags=0x0100 (RD=1), QDCOUNT=1, ANCOUNT=0, NSCOUNT=0, ARCOUNT=0
    const packet = `123401000001000000000000${EXAMPLE_COM_QNAME}00010001`;

    const result = await handlers.handleProtoDissectDns({ packetHex: packet });

    expect(result.success).toBe(true);
    expect(result.byteLength).toBe(packet.length / 2);
    expect(result.message).not.toBeNull();
    const header = result.message!.header;
    expect(header.id).toBe(0x1234);
    expect(header.qr).toBe(0);
    expect(header.opcode).toBe(0);
    expect(header.opcodeMnemonic).toBe('QUERY');
    expect(header.recursionDesired).toBe(true);
    expect(header.rcode).toBe(0);
    expect(header.rcodeMnemonic).toBe('NOERROR');
    expect(result.message!.questions).toHaveLength(1);
    expect(result.message!.questions[0]).toMatchObject({
      name: 'example.com',
      qtype: 1,
      qtypeMnemonic: 'A',
      qclass: 1,
      qclassMnemonic: 'IN',
    });
    expect(eventBus.emit).toHaveBeenCalledWith(
      'protocol:dns_dissected',
      expect.objectContaining({ byteLength: result.byteLength, questionCount: 1 }),
    );
  });

  it('decodes an A response with a compression pointer and an IPv4 RDATA', async () => {
    // ID=0x1234, flags=0x8180 (QR=1, RD=1, RA=1), QD=1, AN=1, NS=0, AR=0
    // Answer uses compression pointer 0xc00c back to the question name.
    // RDATA = 93.184.216.34 = 5d b8 d8 22, TTL=300=0x012c
    const packet =
      `123481800001000100000000` +
      `${EXAMPLE_COM_QNAME}00010001` +
      `c00c000100010000012c00045db8d822`;

    const result = await handlers.handleProtoDissectDns({ packetHex: packet });

    expect(result.success).toBe(true);
    const message = result.message!;
    expect(message.header.qr).toBe(1);
    expect(message.header.recursionAvailable).toBe(true);
    expect(message.answers).toHaveLength(1);
    expect(message.answers[0]).toMatchObject({
      name: 'example.com',
      type: 1,
      typeMnemonic: 'A',
      class: 1,
      ttl: 300,
      rdlength: 4,
    });
    expect(message.answers[0]?.decoded).toMatchObject({ address: '93.184.216.34' });
  });

  it('decodes a CNAME response where the answer points back via compression', async () => {
    // Question: www.example.com A IN
    // Answer: www.example.com CNAME example.com (pointer 0xc00c + labels)
    const packet =
      `000081800001000100000000` +
      `${WWW_EXAMPLE_COM_QNAME}00010001` +
      // CNAME RR: name=www.example.com (pointer 0xc00c back to question at offset 12),
      //   type=5(CNAME), class=1(IN), ttl=300(0x012c), rdlength=13(0x000d)
      `c00c000500010000012c000d` +
      // RDATA: 07 65 78 61 6d 70 6c 65 03 63 6f 6d 00 = "example.com" (13 bytes)
      `076578616d706c6503636f6d00`;

    const result = await handlers.handleProtoDissectDns({ packetHex: packet });

    expect(result.success).toBe(true);
    const message = result.message!;
    expect(message.questions[0]?.name).toBe('www.example.com');
    expect(message.answers[0]?.typeMnemonic).toBe('CNAME');
    expect(message.answers[0]?.decoded).toMatchObject({ target: 'example.com' });
  });

  it('decodes a TXT record with one character-string entry', async () => {
    // RDATA: 05 68 65 6c 6c 6f = length 5 + "hello"
    const packet =
      `000081800001000100000000` +
      `${EXAMPLE_COM_QNAME}00010001` +
      `c00c001000010000012c00060568656c6c6f`;

    const result = await handlers.handleProtoDissectDns({ packetHex: packet });

    expect(result.success).toBe(true);
    expect(result.message!.answers[0]?.typeMnemonic).toBe('TXT');
    expect(result.message!.answers[0]?.decoded).toMatchObject({ entries: ['hello'] });
  });

  it('decodes an MX record into preference + exchange', async () => {
    // RDATA: preference=0x000a=10, exchange="mail.example.com"
    // mail.example.com = 04 6d 61 69 6c 07 65 78 61 6d 70 6c 65 03 63 6f 6d 00
    const mxRdata = `000a046d61696c076578616d706c6503636f6d00`;
    const rdlength = (mxRdata.length / 2).toString(16).padStart(4, '0');
    const packet =
      `000081800001000100000000` +
      `${EXAMPLE_COM_QNAME}00010001` +
      `c00c000f00010000012c${rdlength}${mxRdata}`;

    const result = await handlers.handleProtoDissectDns({ packetHex: packet });

    expect(result.success).toBe(true);
    expect(result.message!.answers[0]?.typeMnemonic).toBe('MX');
    expect(result.message!.answers[0]?.decoded).toMatchObject({
      preference: 10,
      exchange: 'mail.example.com',
    });
  });

  it('decodes an AAAA record into an IPv6 address string', async () => {
    // RDATA: 2001:0db8::0001 = 20010db8000000000000000000000001
    const packet =
      `000081800001000100000000` +
      `${EXAMPLE_COM_QNAME}00010001` +
      `c00c001c00010000012c001020010db8000000000000000000000001`;

    const result = await handlers.handleProtoDissectDns({ packetHex: packet });

    expect(result.success).toBe(true);
    expect(result.message!.answers[0]?.typeMnemonic).toBe('AAAA');
    const decoded = result.message!.answers[0]?.decoded as { address: string };
    expect(decoded.address).toMatch(/2001:db8:.*:1$/i);
  });

  it('decodes an EDNS(0) OPT pseudo-record in the additional section', async () => {
    // ID=0xabcd, flags=0x0100, QD=1, AN=0, NS=0, AR=1
    // Additional OPT record: root name(00) + TYPE=OPT(0x0029) + CLASS=4096(0x1000 UDP size)
    //   + TTL=0x00000000 + RDLENGTH=0x0000
    const optRecord = '0000291000000000000000';
    const packet = `abcd01000001000000000001${EXAMPLE_COM_QNAME}00010001${optRecord}`;

    const result = await handlers.handleProtoDissectDns({ packetHex: packet });

    expect(result.success).toBe(true);
    const message = result.message!;
    expect(message.additionalCount).toBe(1);
    expect(message.additionals).toHaveLength(1);
    expect(message.additionals[0]?.typeMnemonic).toBe('OPT');
    expect(message.additionals[0]?.decoded).toMatchObject({
      udpPayloadSize: 4096,
      extendedRcode: 0,
      version: 0,
      dnssecOk: false,
    });
  });

  it('parses SERVFAIL and NXDOMAIN response codes', async () => {
    // flags=0x8182 → RA=1, RCODE=2 (SERVFAIL)
    const servfail = `000081820001000000000000${EXAMPLE_COM_QNAME}00010001`;
    const servfailResult = await handlers.handleProtoDissectDns({ packetHex: servfail });
    expect(servfailResult.message!.header.rcode).toBe(2);
    expect(servfailResult.message!.header.rcodeMnemonic).toBe('SERVFAIL');

    // flags=0x8183 → RCODE=3 (NXDOMAIN)
    const nxdomain = `000081830001000000000000${EXAMPLE_COM_QNAME}00010001`;
    const nxdomainResult = await handlers.handleProtoDissectDns({ packetHex: nxdomain });
    expect(nxdomainResult.message!.header.rcode).toBe(3);
    expect(nxdomainResult.message!.header.rcodeMnemonic).toBe('NXDOMAIN');
  });

  it('rejects a payload shorter than the 12-byte header', async () => {
    const result = await handlers.handleProtoDissectDns({ packetHex: '00010002' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('header requires 12 bytes');
    expect(result.message).toBeNull();
  });

  it('returns a structured error for invalid hex', async () => {
    const result = await handlers.handleProtoDissectDns({ packetHex: 'xyz' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('hex');
  });

  it('returns a structured error when packetHex is missing', async () => {
    const result = await handlers.handleProtoDissectDns({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('packetHex');
  });
});
