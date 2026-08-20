import type { ParsedMacAddress } from './types';

export function computeInternetChecksum(buffer: Buffer): number {
  let sum = 0;
  for (let offset = 0; offset < buffer.length; offset += 2) {
    const high = buffer[offset] ?? 0;
    const low = buffer[offset + 1] ?? 0;
    sum += (high << 8) | low;
    while (sum > 0xffff) {
      sum = (sum & 0xffff) + (sum >>> 16);
    }
  }
  return ~sum & 0xffff;
}

export function buildEthernetFrame(
  destinationMac: ParsedMacAddress,
  sourceMac: ParsedMacAddress,
  etherType: number,
  payload: Buffer,
): Buffer {
  const header = Buffer.alloc(14);
  destinationMac.bytes.copy(header, 0);
  sourceMac.bytes.copy(header, 6);
  header.writeUInt16BE(etherType, 12);
  return Buffer.concat([header, payload]);
}

export function buildArpPayload(args: {
  operation: 'request' | 'reply';
  hardwareType: number;
  protocolType: number;
  hardwareSize: number;
  protocolSize: number;
  senderMac: ParsedMacAddress;
  senderIp: Buffer;
  targetMac: ParsedMacAddress;
  targetIp: Buffer;
}): Buffer {
  if (
    args.hardwareSize !== args.senderMac.bytes.length ||
    args.hardwareSize !== args.targetMac.bytes.length
  ) {
    throw new Error('hardwareSize must match the provided MAC address lengths');
  }
  if (args.protocolSize !== args.senderIp.length || args.protocolSize !== args.targetIp.length) {
    throw new Error('protocolSize must match the provided IP address lengths');
  }

  const buffer = Buffer.alloc(8 + args.hardwareSize * 2 + args.protocolSize * 2);
  let offset = 0;
  buffer.writeUInt16BE(args.hardwareType, offset);
  offset += 2;
  buffer.writeUInt16BE(args.protocolType, offset);
  offset += 2;
  buffer.writeUInt8(args.hardwareSize, offset++);
  buffer.writeUInt8(args.protocolSize, offset++);
  buffer.writeUInt16BE(args.operation === 'reply' ? 2 : 1, offset);
  offset += 2;
  args.senderMac.bytes.copy(buffer, offset);
  offset += args.hardwareSize;
  args.senderIp.copy(buffer, offset);
  offset += args.protocolSize;
  args.targetMac.bytes.copy(buffer, offset);
  offset += args.hardwareSize;
  args.targetIp.copy(buffer, offset);
  return buffer;
}

export function buildIpv4Packet(args: {
  sourceIp: Buffer;
  destinationIp: Buffer;
  protocol: number;
  payload: Buffer;
  ttl: number;
  identification: number;
  dontFragment: boolean;
  moreFragments: boolean;
  fragmentOffset: number;
  dscp: number;
  ecn: number;
}): { packet: Buffer; checksum: number } {
  const header = Buffer.alloc(20);
  header[0] = 0x45;
  header[1] = ((args.dscp & 0x3f) << 2) | (args.ecn & 0x03);
  header.writeUInt16BE(header.length + args.payload.length, 2);
  header.writeUInt16BE(args.identification, 4);
  const flags = ((args.dontFragment ? 1 : 0) << 1) | (args.moreFragments ? 1 : 0);
  header.writeUInt16BE(((flags & 0x7) << 13) | (args.fragmentOffset & 0x1fff), 6);
  header[8] = args.ttl;
  header[9] = args.protocol;
  header.writeUInt16BE(0, 10);
  args.sourceIp.copy(header, 12);
  args.destinationIp.copy(header, 16);
  const checksum = computeInternetChecksum(header);
  header.writeUInt16BE(checksum, 10);
  return {
    packet: Buffer.concat([header, args.payload]),
    checksum,
  };
}

export function buildIpv6Packet(args: {
  sourceIp: Buffer;
  destinationIp: Buffer;
  protocol: number;
  payload: Buffer;
  hopLimit: number;
  dscp: number;
  ecn: number;
  flowLabel: number;
}): Buffer {
  const header = Buffer.alloc(40);
  const trafficClass = ((args.dscp & 0x3f) << 2) | (args.ecn & 0x03);
  const versionTrafficFlow =
    (6 << 28) | ((trafficClass & 0xff) << 20) | (args.flowLabel & 0x000fffff);
  header.writeUInt32BE(versionTrafficFlow >>> 0, 0);
  header.writeUInt16BE(args.payload.length, 4);
  header.writeUInt8(args.protocol, 6);
  header.writeUInt8(args.hopLimit, 7);
  args.sourceIp.copy(header, 8);
  args.destinationIp.copy(header, 24);
  return Buffer.concat([header, args.payload]);
}

export function buildIcmpEcho(args: {
  operation: 'request' | 'reply';
  identifier: number;
  sequenceNumber: number;
  payload: Buffer;
}): { packet: Buffer; checksum: number } {
  const packet = Buffer.alloc(8 + args.payload.length);
  packet[0] = args.operation === 'reply' ? 0 : 8;
  packet[1] = 0;
  packet.writeUInt16BE(0, 2);
  packet.writeUInt16BE(args.identifier, 4);
  packet.writeUInt16BE(args.sequenceNumber, 6);
  args.payload.copy(packet, 8);
  const checksum = computeInternetChecksum(packet);
  packet.writeUInt16BE(checksum, 2);
  return { packet, checksum };
}
