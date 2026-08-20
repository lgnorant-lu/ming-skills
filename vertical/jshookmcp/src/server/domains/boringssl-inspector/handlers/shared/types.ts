import type { Socket as NetSocket } from 'node:net';
import type { DetailedPeerCertificate, PeerCertificate, TLSSocket } from 'node:tls';

export const TLS_VERSION_SET = new Set(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'] as const);

export type ProbeTlsVersion = 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3';
export type ProbePeerCertificate = DetailedPeerCertificate | PeerCertificate;
export type SessionKind = 'tcp' | 'tls';
export type SessionSocket = NetSocket | TLSSocket;

export type PeerCertificateSummary = {
  depth: number;
  subject: string | null;
  issuer: string | null;
  subjectAltName: string | null;
  serialNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint256: string | null;
  fingerprint512: string | null;
  rawLength: number | null;
  isCA: boolean | null;
  selfIssued: boolean | null;
};

export type TlsPolicySummary = {
  allowInvalidCertificates: boolean;
  skipHostnameCheck: boolean;
  timeoutMs: number;
  minVersion: ProbeTlsVersion | null;
  maxVersion: ProbeTlsVersion | null;
  alpnProtocols: string[];
  customCa: {
    source: 'inline' | 'path' | null;
    path: string | null;
    bytes: number | null;
  };
};

export type TlsTargetSummary = {
  host: string;
  port: number;
  requestedServername: string | null;
  validationTarget: string;
};

export type BufferedSession<TSocket extends SessionSocket = SessionSocket> = {
  id: string;
  kind: SessionKind;
  socket: TSocket;
  host: string;
  port: number;
  createdAt: number;
  buffer: Buffer;
  ended: boolean;
  closed: boolean;
  error: string | null;
  waiters: Set<() => void>;
  activeRead: boolean;
};

export type TcpSession = BufferedSession<NetSocket>;

export type TlsSession = BufferedSession<TLSSocket> & {
  metadata: {
    target: TlsTargetSummary;
    policy: TlsPolicySummary;
    transport: {
      protocol: string | null;
      alpnProtocol: string | null;
      cipher: {
        name: string;
        standardName: string;
        version: string;
      };
      localAddress: string | null;
      localPort: number | null;
      remoteAddress: string | null;
      remotePort: number | null;
      servernameSent: string | null;
      sessionReused: boolean;
    };
    authorization: {
      socketAuthorized: boolean;
      authorizationError: string | null;
      hostnameValidation: {
        checked: boolean;
        target: string | null;
        matched: boolean | null;
        error: string | null;
      };
      policyAllowed: boolean;
      reasons: string[];
    };
    certificates: {
      leaf: PeerCertificateSummary | null;
      chain: PeerCertificateSummary[];
    };
  };
};

export type WebSocketScheme = 'ws' | 'wss';
export type WebSocketFrameType = 'text' | 'binary' | 'close' | 'ping' | 'pong';

export type WebSocketTargetSummary = {
  scheme: WebSocketScheme;
  url: string;
  host: string;
  port: number;
  path: string;
  requestedServername: string | null;
  validationTarget: string | null;
};

export type WebSocketFrame = {
  type: WebSocketFrameType;
  fin: boolean;
  opcode: number;
  masked: boolean;
  data: Buffer;
  closeCode: number | null;
  closeReason: string | null;
  receivedAt: number;
};

export type WebSocketSession = {
  id: string;
  kind: 'websocket';
  scheme: WebSocketScheme;
  socket: SessionSocket;
  host: string;
  port: number;
  path: string;
  createdAt: number;
  parserBuffer: Buffer;
  frames: WebSocketFrame[];
  ended: boolean;
  closed: boolean;
  error: string | null;
  waiters: Set<() => void>;
  activeRead: boolean;
  closeSent: boolean;
  closeReceived: boolean;
  metadata: {
    target: WebSocketTargetSummary;
    handshake: {
      requestKey: string;
      acceptKey: string;
      responseAcceptKey: string | null;
      subprotocol: string | null;
    };
    transport: {
      localAddress: string | null;
      localPort: number | null;
      remoteAddress: string | null;
      remotePort: number | null;
      protocol: string | null;
      alpnProtocol: string | null;
      servernameSent: string | null;
      sessionReused: boolean | null;
    };
    authorization: TlsSession['metadata']['authorization'] | null;
    certificates: TlsSession['metadata']['certificates'] | null;
  };
};

export type WebSocketEventName =
  | 'websocket:session_opened'
  | 'websocket:session_written'
  | 'websocket:frame_read'
  | 'websocket:session_closed';

export type ConsumedSessionBuffer = {
  data: Buffer;
  matchedDelimiter: boolean;
  stopReason: 'delimiter' | 'maxBytes' | 'closed' | 'error';
  delimiterHex: string | null;
};
