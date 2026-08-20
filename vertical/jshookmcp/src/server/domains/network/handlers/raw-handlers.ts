/**
 * Raw HTTP/HTTP2/DNS/RTT handlers — facade over focused sub-handlers.
 */

import type { EventBus, ServerEventMap } from '@server/EventBus';
import { RawDnsHttpHandlers } from './raw-dns-http-handlers';
import { RawHttp2Handlers } from './raw-http2-handlers';
import { RawGrpcHandlers } from './raw-grpc-handlers';
import { RawLatencyHandlers } from './raw-latency-handlers';

export class RawHandlers extends RawLatencyHandlers {
  private readonly dnsHttp: RawDnsHttpHandlers;
  private readonly http2: RawHttp2Handlers;
  private readonly grpc: RawGrpcHandlers;

  constructor(eventBus?: EventBus<ServerEventMap>) {
    super(eventBus);
    this.dnsHttp = new RawDnsHttpHandlers(eventBus);
    this.http2 = new RawHttp2Handlers(eventBus);
    this.grpc = new RawGrpcHandlers(eventBus);
  }

  handleDnsResolve(args: Record<string, unknown>) {
    return this.dnsHttp.handleDnsResolve(args);
  }

  handleDnsReverse(args: Record<string, unknown>) {
    return this.dnsHttp.handleDnsReverse(args);
  }

  handleDnsProbe(args: Record<string, unknown>) {
    return this.dnsHttp.handleDnsProbe(args);
  }

  handleDnsCnameChain(args: Record<string, unknown>) {
    return this.dnsHttp.handleDnsCnameChain(args);
  }

  handleDnsBulkResolve(args: Record<string, unknown>) {
    return this.dnsHttp.handleDnsBulkResolve(args);
  }

  handleHttpRequestBuild(args: Record<string, unknown>) {
    return this.dnsHttp.handleHttpRequestBuild(args);
  }

  handleHttpPlainRequest(args: Record<string, unknown>) {
    return this.dnsHttp.handleHttpPlainRequest(args);
  }

  handleHttp2Probe(args: Record<string, unknown>) {
    return this.http2.handleHttp2Probe(args);
  }

  handleHttp2FrameBuild(args: Record<string, unknown>) {
    return this.http2.handleHttp2FrameBuild(args);
  }

  handleHttp2FrameParse(args: Record<string, unknown>) {
    return this.http2.handleHttp2FrameParse(args);
  }

  handleNetworkHttp2Fingerprint(args: Record<string, unknown>) {
    return this.http2.handleNetworkHttp2Fingerprint(args);
  }

  handleGrpcFrameParse(args: Record<string, unknown>) {
    return this.grpc.handleGrpcFrameParse(args);
  }

  handleGrpcFrameBuild(args: Record<string, unknown>) {
    return this.grpc.handleGrpcFrameBuild(args);
  }
}
