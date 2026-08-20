export type ParsedMacAddress = {
  canonical: string;
  bytes: Buffer;
};

export type ChecksumEndian = 'big' | 'little';
export type PacketEndianness = 'little' | 'big';
export type PacketTimestampPrecision = 'micro' | 'nano';

export type PcapPacketInput = {
  data: Buffer;
  timestampSeconds: number;
  timestampFraction: number;
  originalLength: number;
};

export type PcapHeader = {
  endianness: PacketEndianness;
  timestampPrecision: PacketTimestampPrecision;
  versionMajor: number;
  versionMinor: number;
  snapLength: number;
  linkType: number;
};

export type PcapPacketSummary = {
  index: number;
  timestampSeconds: number;
  timestampFraction: number;
  includedLength: number;
  originalLength: number;
  dataHex: string;
  truncated: boolean;
};

export const ETHER_TYPE_MAP = Object.freeze({
  arp: 0x0806,
  ipv4: 0x0800,
  ipv6: 0x86dd,
  vlan: 0x8100,
});
export const IP_PROTOCOL_MAP = Object.freeze({
  icmp: 1,
  igmp: 2,
  tcp: 6,
  udp: 17,
  gre: 47,
  esp: 50,
  ah: 51,
  icmpv6: 58,
  ospf: 89,
});
export const PCAP_LINK_TYPE_MAP = Object.freeze({
  loopback: 0,
  ethernet: 1,
  raw: 101,
});
