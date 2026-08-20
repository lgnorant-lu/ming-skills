import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { R } from '@server/domains/shared/ResponseBuilder';
import {
  parseOptionalString,
  parseNetworkAuthorization,
  clamp,
  roundMs,
  computeRttStats,
  resolveAuthorizedTransportTarget,
  resolveAuthorizedHostTarget,
} from './raw-helpers';
import { emitEvent, parseNumberArg } from './shared';
import { icmpProbe, traceroute, isIcmpAvailable } from '@native/IcmpProbe';

const PROBE_TYPE_VALUES = ['tcp', 'tls', 'http'] as const;
type ProbeType = (typeof PROBE_TYPE_VALUES)[number];

function parseProbeType(rawValue: unknown, fallback: ProbeType): ProbeType {
  const value = parseOptionalString(rawValue, 'probeType') ?? fallback;
  if (value === 'tcp' || value === 'tls' || value === 'http') {
    return value;
  }
  throw new Error('probeType must be one of: tcp, tls, http');
}

function isLookupAllOptions(value: unknown): value is { all: true } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'all' in value &&
    (value as { all?: unknown }).all === true
  );
}

type PinnedLookupOneCallback = (
  error: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

type PinnedLookupAllCallback = (
  error: NodeJS.ErrnoException | null,
  addresses: Array<{ address: string; family: number }>,
) => void;

export class RawLatencyHandlers {
  constructor(private readonly eventBus?: EventBus<ServerEventMap>) {}

  async handleNetworkRttMeasure(args: Record<string, unknown>) {
    const urlRaw = parseOptionalString(args.url, 'url');
    if (!urlRaw) {
      throw new Error('url is required');
    }

    const probeType = parseProbeType(args.probeType, 'tcp');

    const iterations = clamp(
      args.iterations !== undefined
        ? parseNumberArg(args.iterations, { defaultValue: 5, min: 1, integer: true })
        : 5,
      1,
      50,
    );
    const timeoutMs = clamp(
      args.timeoutMs !== undefined
        ? parseNumberArg(args.timeoutMs, { defaultValue: 5000, min: 100, integer: true })
        : 5000,
      100,
      30000,
    );
    const authorization = parseNetworkAuthorization(args.authorization);
    const { url, target } = await resolveAuthorizedTransportTarget(
      urlRaw,
      authorization,
      'RTT measurement',
    );

    const hostname = target.hostname;
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    const resolvedIp = target.resolvedAddress ?? hostname;
    const useHttps = url.protocol === 'https:';
    const samples: number[] = [];
    const errors: string[] = [];

    for (let index = 0; index < iterations; index += 1) {
      try {
        const rtt = await this.measureSingleRtt(
          hostname,
          resolvedIp,
          port,
          probeType,
          timeoutMs,
          useHttps,
        );
        samples.push(rtt);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const stats = computeRttStats(samples);

    emitEvent(this.eventBus, 'network:rtt_measured', {
      url: urlRaw,
      probeType,
      iterations,
      successCount: samples.length,
      errorCount: errors.length,
      stats,
      timestamp: new Date().toISOString(),
    });

    return R.ok()
      .merge({
        target: { hostname, port, resolvedIp, probeType },
        stats,
        samples,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString(),
      })
      .json();
  }

  async handleNetworkTraceroute(args: Record<string, unknown>) {
    try {
      if (!isIcmpAvailable()) {
        return R.text(
          'ICMP traceroute not available on this platform (Windows: native API, Linux/macOS: requires ' +
            'root/CAP_NET_RAW)',
          true,
        );
      }
      const target = parseOptionalString(args.target, 'target');
      if (!target) {
        return R.text('target is required', true);
      }
      const authorization = parseNetworkAuthorization(args.authorization);
      let resolvedTarget: string;
      try {
        resolvedTarget = await resolveAuthorizedHostTarget(target, authorization, 'Traceroute');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return R.fail(message).json();
      }
      const maxHops = clamp(
        args.maxHops !== undefined
          ? parseNumberArg(args.maxHops, { defaultValue: 30, min: 1, integer: true })
          : 30,
        1,
        64,
      );
      const timeout = clamp(
        args.timeout !== undefined
          ? parseNumberArg(args.timeout, { defaultValue: 5000, min: 100, integer: true })
          : 5000,
        100,
        30000,
      );
      const packetSize = clamp(
        args.packetSize !== undefined
          ? parseNumberArg(args.packetSize, { defaultValue: 32, min: 8, integer: true })
          : 32,
        8,
        65500,
      );

      const result = await traceroute({ target: resolvedTarget, maxHops, timeout, packetSize });
      return R.ok()
        .merge({ resolvedFrom: target })
        .json(result as unknown as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`Traceroute failed: ${message}`).json();
    }
  }

  async handleNetworkLatencyStats(args: Record<string, unknown>) {
    const urlRaw = parseOptionalString(args.url, 'url');
    if (!urlRaw) {
      return R.text('url is required', true);
    }

    let probeType: ProbeType;
    try {
      probeType = parseProbeType(args.probeType, 'http');
    } catch (error) {
      return R.text(
        error instanceof Error
          ? `Invalid probeType: "${String(args.probeType)}". Expected one of: tcp, tls, http`
          : 'Invalid probeType',
        true,
      );
    }

    const iterations = clamp(
      args.iterations !== undefined
        ? parseNumberArg(args.iterations, { defaultValue: 20, min: 5, integer: true })
        : 20,
      5,
      100,
    );
    const concurrency = clamp(
      args.concurrency !== undefined
        ? parseNumberArg(args.concurrency, { defaultValue: 5, min: 1, integer: true })
        : 5,
      1,
      20,
    );
    const timeoutMs = clamp(
      args.timeoutMs !== undefined
        ? parseNumberArg(args.timeoutMs, { defaultValue: 5000, min: 100, integer: true })
        : 5000,
      100,
      30000,
    );

    const authorization = parseNetworkAuthorization(args.authorization);
    const { url, target } = await resolveAuthorizedTransportTarget(
      urlRaw,
      authorization,
      'Latency stats',
    );

    const hostname = target.hostname;
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    const resolvedIp = target.resolvedAddress ?? hostname;
    const useHttps = url.protocol === 'https:';
    const samples: number[] = [];
    const errors: string[] = [];

    for (let i = 0; i < iterations; i += concurrency) {
      const batch = Array.from(
        { length: Math.min(concurrency, iterations - i) },
        (_, idx) => idx + i,
      );
      const results = await Promise.allSettled(
        batch.map(() =>
          this.measureSingleRtt(hostname, resolvedIp, port, probeType, timeoutMs, useHttps),
        ),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          samples.push(result.value);
        } else {
          errors.push(
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
        }
      }
    }

    const stats = computeRttStats(samples);

    return R.ok().json({
      url: urlRaw,
      target: { hostname, port, resolvedIp, probeType },
      iterations,
      concurrency,
      stats,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  async handleNetworkIcmpProbe(args: Record<string, unknown>) {
    try {
      if (!isIcmpAvailable()) {
        return R.text(
          'ICMP probe not available on this platform (Windows: native API, Linux/macOS: requires root/CAP_NET_RAW)',
          true,
        );
      }
      const target = parseOptionalString(args.target, 'target');
      if (!target) {
        return R.text('target is required', true);
      }
      const authorization = parseNetworkAuthorization(args.authorization);
      let resolvedTarget: string;
      try {
        resolvedTarget = await resolveAuthorizedHostTarget(target, authorization, 'ICMP probe');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return R.fail(message).json();
      }
      const ttl = clamp(
        args.ttl !== undefined
          ? parseNumberArg(args.ttl, { defaultValue: 128, min: 1, integer: true })
          : 128,
        1,
        255,
      );
      const timeout = clamp(
        args.timeout !== undefined
          ? parseNumberArg(args.timeout, { defaultValue: 5000, min: 100, integer: true })
          : 5000,
        100,
        30000,
      );
      const packetSize = clamp(
        args.packetSize !== undefined
          ? parseNumberArg(args.packetSize, { defaultValue: 32, min: 8, integer: true })
          : 32,
        8,
        65500,
      );

      const result = await icmpProbe({ target: resolvedTarget, ttl, packetSize, timeout });
      return R.ok()
        .merge({ resolvedFrom: target })
        .json(result as unknown as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`ICMP probe failed: ${message}`).json();
    }
  }

  measureSingleRtt(
    hostname: string,
    address: string,
    port: number,
    probeType: 'tcp' | 'tls' | 'http',
    timeoutMs: number,
    useHttps: boolean,
  ): Promise<number> {
    switch (probeType) {
      case 'tcp':
        return this.probeTcp(address, port, timeoutMs);
      case 'tls':
        return this.probeTls(hostname, address, port, timeoutMs);
      case 'http':
        return this.probeHttp(hostname, address, port, timeoutMs, useHttps);
    }
  }

  createPinnedLookup(address: string): net.LookupFunction {
    const family = net.isIP(address) === 6 ? 6 : 4;
    return (
      _hostname: string,
      optionsOrCallback: unknown,
      maybeCallback?: PinnedLookupOneCallback | PinnedLookupAllCallback,
    ): void => {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
      if (!callback) {
        return;
      }
      if (isLookupAllOptions(optionsOrCallback)) {
        (callback as PinnedLookupAllCallback)(null, [{ address, family }]);
        return;
      }
      (callback as PinnedLookupOneCallback)(null, address, family);
    };
  }

  probeTcp(host: string, port: number, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const timer = setTimeout(
        () => reject(new Error(`TCP probe timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      const socket = net.createConnection({ host, port }, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(roundMs(performance.now() - start));
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      });
    });
  }

  probeTls(hostname: string, address: string, port: number, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      let settled = false;
      let socket: tls.TLSSocket | null = null;
      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket?.destroy();
        callback();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error(`TLS probe timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      socket = tls.connect(
        {
          host: hostname,
          port,
          lookup: this.createPinnedLookup(address),
          ...(net.isIP(hostname) === 0 ? { servername: hostname } : {}),
        },
        () => {
          finish(() => resolve(roundMs(performance.now() - start)));
        },
      );
      socket.on('error', (err) => {
        finish(() => reject(err));
      });
    });
  }

  probeHttp(
    hostname: string,
    address: string,
    port: number,
    timeoutMs: number,
    useHttps: boolean,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      let settled = false;
      let request: http.ClientRequest | null = null;
      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        request?.destroy();
        callback();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error(`HTTP probe timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      const requestFactory = useHttps ? https.request : http.request;
      request = requestFactory(
        {
          host: hostname,
          port,
          path: '/',
          method: 'HEAD',
          lookup: this.createPinnedLookup(address),
          ...(useHttps && net.isIP(hostname) === 0 ? { servername: hostname } : {}),
        },
        (response) => {
          response.resume();
          finish(() => resolve(roundMs(performance.now() - start)));
        },
      );
      request.on('error', (error) => {
        finish(() => reject(error));
      });
      request.end();
    });
  }
}
