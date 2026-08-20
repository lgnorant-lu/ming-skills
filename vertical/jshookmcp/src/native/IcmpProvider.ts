/**
 * ICMP Provider Interface — platform-agnostic ICMP probe abstraction.
 *
 * @module IcmpProvider
 */

// ── Exported Types ──

export interface IcmpProbeResult {
  target: string;
  ip: string;
  alive: boolean;
  rtt: number | null;
  ttl: number;
  icmpStatus: string;
  errorClass: string;
  packetSize: number;
}

export interface TracerouteHop {
  hop: number;
  ip: string | null;
  rtt: number | null;
  status: string;
  errorClass: string;
}

export interface TracerouteResult {
  target: string;
  ip: string;
  hops: TracerouteHop[];
  reached: boolean;
  totalHops: number;
  totalTime: number;
}

export interface IcmpProbeParams {
  target: string;
  ttl?: number;
  packetSize?: number;
  timeout?: number;
}

export interface TracerouteParams {
  target: string;
  maxHops?: number;
  timeout?: number;
  packetSize?: number;
}

export interface IcmpProvider {
  probe(params: IcmpProbeParams): Promise<IcmpProbeResult>;
  traceroute(params: TracerouteParams): Promise<TracerouteResult>;
  isAvailable(): boolean;
}

export abstract class BaseIcmpProvider implements IcmpProvider {
  abstract probe(params: IcmpProbeParams): Promise<IcmpProbeResult>;
  abstract traceroute(params: TracerouteParams): Promise<TracerouteResult>;
  abstract isAvailable(): boolean;

  protected validateIp(ip: string): boolean {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => {
      const n = parseInt(p, 10);
      return !isNaN(n) && n >= 0 && n <= 255 && p === String(n);
    });
  }

  protected ipToString(addr: number): string {
    return `${addr & 0xff}.${(addr >>> 8) & 0xff}.${(addr >>> 16) & 0xff}.${(addr >>> 24) & 0xff}`;
  }
}
