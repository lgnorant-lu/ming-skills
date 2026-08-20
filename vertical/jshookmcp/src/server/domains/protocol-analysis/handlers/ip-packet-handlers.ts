/**
 * ProtocolAnalysisIpPacketHandlers — IP and ICMP packet builders.
 */

import type { ToolArgs } from '@server/types';
import {
  buildIcmpEcho,
  buildIpv4Packet,
  buildIpv6Packet,
  parseByte,
  parseHexPayload,
  parseIpAddress,
  parseIpProtocol,
  parseNonNegativeInteger,
} from './shared';
import { ProtocolAnalysisLinkLayerHandlers } from './link-layer-handlers';

export class ProtocolAnalysisIpPacketHandlers extends ProtocolAnalysisLinkLayerHandlers {
  async handleRawIpPacketBuild(args: ToolArgs): Promise<{
    version: 'ipv4' | 'ipv6' | null;
    protocol: number | null;
    byteLength: number;
    headerLength: number;
    packetHex: string;
    headerHex: string;
    payloadHex: string;
    checksumHex: string | null;
    success?: boolean;
    error?: string;
  }> {
    try {
      const version = args.version === 'ipv6' ? 'ipv6' : 'ipv4';
      const payload = parseHexPayload(args.payloadHex ?? '', 'payloadHex');
      const protocol = parseIpProtocol(args.protocol, 'protocol');
      const dscp = args.dscp === undefined ? 0 : parseNonNegativeInteger(args.dscp, 'dscp');
      const ecn = args.ecn === undefined ? 0 : parseNonNegativeInteger(args.ecn, 'ecn');
      if (dscp > 63) {
        throw new Error('dscp must be between 0 and 63');
      }
      if (ecn > 3) {
        throw new Error('ecn must be between 0 and 3');
      }

      if (version === 'ipv4') {
        const ttl = args.ttl === undefined ? 64 : parseByte(args.ttl, 'ttl');
        const identification =
          args.identification === undefined
            ? 0
            : parseNonNegativeInteger(args.identification, 'identification');
        const fragmentOffset =
          args.fragmentOffset === undefined
            ? 0
            : parseNonNegativeInteger(args.fragmentOffset, 'fragmentOffset');
        if (identification > 0xffff) {
          throw new Error('identification must be between 0 and 65535');
        }
        if (fragmentOffset > 0x1fff) {
          throw new Error('fragmentOffset must be between 0 and 8191');
        }

        const { packet, checksum } = buildIpv4Packet({
          sourceIp: parseIpAddress(args.sourceIp, 'ipv4', 'sourceIp'),
          destinationIp: parseIpAddress(args.destinationIp, 'ipv4', 'destinationIp'),
          protocol,
          payload,
          ttl,
          identification,
          dontFragment: args.dontFragment === true,
          moreFragments: args.moreFragments === true,
          fragmentOffset,
          dscp,
          ecn,
        });
        this.emitEvent('protocol:ip_packet_built', {
          version,
          protocol,
          byteLength: packet.length,
        });
        return {
          version,
          protocol,
          byteLength: packet.length,
          headerLength: 20,
          packetHex: packet.toString('hex'),
          headerHex: packet.subarray(0, 20).toString('hex'),
          payloadHex: payload.toString('hex'),
          checksumHex: checksum.toString(16).padStart(4, '0'),
          success: true,
        };
      }

      const hopLimit =
        args.hopLimit === undefined
          ? args.ttl === undefined
            ? 64
            : parseByte(args.ttl, 'ttl')
          : parseByte(args.hopLimit, 'hopLimit');
      const flowLabel =
        args.flowLabel === undefined ? 0 : parseNonNegativeInteger(args.flowLabel, 'flowLabel');
      if (flowLabel > 0x000fffff) {
        throw new Error('flowLabel must be between 0 and 1048575');
      }

      const packet = buildIpv6Packet({
        sourceIp: parseIpAddress(args.sourceIp, 'ipv6', 'sourceIp'),
        destinationIp: parseIpAddress(args.destinationIp, 'ipv6', 'destinationIp'),
        protocol,
        payload,
        hopLimit,
        dscp,
        ecn,
        flowLabel,
      });
      this.emitEvent('protocol:ip_packet_built', {
        version,
        protocol,
        byteLength: packet.length,
      });
      return {
        version,
        protocol,
        byteLength: packet.length,
        headerLength: 40,
        packetHex: packet.toString('hex'),
        headerHex: packet.subarray(0, 40).toString('hex'),
        payloadHex: payload.toString('hex'),
        checksumHex: null,
        success: true,
      };
    } catch (error) {
      return {
        version: null,
        protocol: null,
        byteLength: 0,
        headerLength: 0,
        packetHex: '',
        headerHex: '',
        payloadHex: '',
        checksumHex: null,
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  async handleIcmpEchoBuild(args: ToolArgs): Promise<{
    operation: 'request' | 'reply' | null;
    identifier: number | null;
    sequenceNumber: number | null;
    checksum: number | null;
    checksumHex: string;
    byteLength: number;
    packetHex: string;
    payloadHex: string;
    success?: boolean;
    error?: string;
  }> {
    try {
      const operation = args.operation === 'reply' ? 'reply' : 'request';
      const identifier =
        args.identifier === undefined ? 0 : parseNonNegativeInteger(args.identifier, 'identifier');
      const sequenceNumber =
        args.sequenceNumber === undefined
          ? 0
          : parseNonNegativeInteger(args.sequenceNumber, 'sequenceNumber');
      if (identifier > 0xffff) {
        throw new Error('identifier must be between 0 and 65535');
      }
      if (sequenceNumber > 0xffff) {
        throw new Error('sequenceNumber must be between 0 and 65535');
      }

      const payload = parseHexPayload(args.payloadHex ?? '', 'payloadHex');
      const { packet, checksum } = buildIcmpEcho({
        operation,
        identifier,
        sequenceNumber,
        payload,
      });
      const checksumHex = checksum.toString(16).padStart(4, '0');
      this.emitEvent('protocol:icmp_echo_built', {
        operation,
        byteLength: packet.length,
        checksumHex,
      });
      return {
        operation,
        identifier,
        sequenceNumber,
        checksum,
        checksumHex,
        byteLength: packet.length,
        packetHex: packet.toString('hex'),
        payloadHex: payload.toString('hex'),
        success: true,
      };
    } catch (error) {
      return {
        operation: null,
        identifier: null,
        sequenceNumber: null,
        checksum: null,
        checksumHex: '',
        byteLength: 0,
        packetHex: '',
        payloadHex: '',
        success: false,
        error: this.errorMessage(error),
      };
    }
  }
}
