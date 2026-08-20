/**
 * Cross-platform ICMP probe and traceroute via koffi FFI.
 *
 * Windows: IcmpSendEcho from iphlpapi.dll (no admin required).
 * Linux/macOS: Raw ICMP sockets via libc (requires root/CAP_NET_RAW).
 *
 * @module IcmpProbe
 */

import { logger } from '@utils/logger';
import type { IcmpProvider, IcmpProbeResult, TracerouteResult } from './IcmpProvider.js';
import { WindowsIcmpProvider } from './IcmpProvider.Windows.js';
import { PosixIcmpProvider } from './IcmpProvider.Posix.js';

// ── Re-export Types ──

export type {
  IcmpProbeResult,
  TracerouteResult,
  TracerouteHop,
  IcmpProbeParams,
  TracerouteParams,
} from './IcmpProvider.js';

// ── Platform Dispatch ──

let cachedAvailable: boolean | null = null;
let cachedProvider: IcmpProvider | null = null;

function getProvider(): IcmpProvider {
  if (cachedProvider) return cachedProvider;

  if (process.platform === 'win32') {
    cachedProvider = WindowsIcmpProvider.instance();
    return cachedProvider;
  }

  if (process.platform === 'linux' || process.platform === 'darwin') {
    cachedProvider = PosixIcmpProvider.instance();
    return cachedProvider;
  }

  throw new Error(`Platform ${process.platform} not supported for ICMP operations`);
}

export function isIcmpAvailable(): boolean {
  if (cachedAvailable !== null) return cachedAvailable;

  try {
    const provider = getProvider();
    cachedAvailable = provider.isAvailable();
  } catch {
    cachedAvailable = false;
  }

  return cachedAvailable;
}

export async function icmpProbe(params: {
  target: string;
  ttl?: number;
  packetSize?: number;
  timeout?: number;
}): Promise<IcmpProbeResult> {
  if (!isIcmpAvailable()) {
    return {
      target: params.target,
      ip: '',
      alive: false,
      rtt: null,
      ttl: params.ttl ?? 128,
      icmpStatus: 'PLATFORM_NOT_SUPPORTED',
      errorClass: 'error',
      packetSize: params.packetSize ?? 32,
    };
  }

  return getProvider().probe(params);
}

export async function traceroute(params: {
  target: string;
  maxHops?: number;
  timeout?: number;
  packetSize?: number;
}): Promise<TracerouteResult> {
  if (!isIcmpAvailable()) {
    return {
      target: params.target,
      ip: '',
      hops: [],
      reached: false,
      totalHops: 0,
      totalTime: 0,
    };
  }

  return getProvider().traceroute(params);
}

export function unloadIcmpLibraries(): {
  unloadedWindows: boolean;
  unloadedPosix: boolean;
} {
  let unloadedWindows = false;
  let unloadedPosix = false;

  if (process.platform === 'win32') {
    WindowsIcmpProvider.unloadLibraries();
    unloadedWindows = true;
  } else if (process.platform === 'linux' || process.platform === 'darwin') {
    PosixIcmpProvider.unloadLibraries();
    unloadedPosix = true;
  }

  cachedProvider = null;
  cachedAvailable = null;
  logger.debug('Unloaded ICMP native libraries');

  return { unloadedWindows, unloadedPosix };
}
