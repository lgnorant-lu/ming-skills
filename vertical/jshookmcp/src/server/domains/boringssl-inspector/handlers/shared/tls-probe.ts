import { readFile } from 'node:fs/promises';
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls';
import { isLoopbackHost, isPrivateHost } from '@utils/network/ssrf-policy';
import { argString } from '@server/domains/shared/parse-args';
import { errorMessage } from './common';

export function validateNetworkTarget(host: string): { ok: false; error: string } | null {
  if (isPrivateHost(host) && !isLoopbackHost(host)) {
    return {
      ok: false,
      error: `Blocked: target host "${host}" resolves to a private/internal address. SSRF protection applies.`,
    };
  }
  return null;
}

export function normalizeSocketServername(
  servername: string | false | null | undefined,
): string | null {
  return typeof servername === 'string' && servername.length > 0 ? servername : null;
}

export function normalizeAlpnProtocol(protocol: string | false | null | undefined): string | null {
  return typeof protocol === 'string' && protocol.length > 0 ? protocol : null;
}

export function applyTlsValidationPolicy(
  options: TlsConnectionOptions,
  allowInvalidCertificates: boolean,
): TlsConnectionOptions {
  const next = { ...options } as TlsConnectionOptions & Record<string, unknown>;
  // Boringssl inspector is a research tool: keep strict validation by default and
  // only relax trust checks for explicit opt-in sessions probing intercepted/self-signed targets.
  Reflect.set(next, 'rejectUnauthorized', !allowInvalidCertificates);
  return next;
}

export async function loadProbeCaBundle(args: Record<string, unknown>): Promise<
  | {
      ok: true;
      ca: string | undefined;
      source: 'inline' | 'path' | null;
      path: string | null;
      bytes: number | null;
    }
  | { ok: false; error: string }
> {
  const caPem = argString(args, 'caPem') ?? null;
  const caPath = argString(args, 'caPath') ?? null;

  if (caPem && caPath) {
    return { ok: false, error: 'caPem and caPath are mutually exclusive' };
  }

  if (caPem) {
    return {
      ok: true,
      ca: caPem,
      source: 'inline',
      path: null,
      bytes: Buffer.byteLength(caPem),
    };
  }

  if (caPath) {
    try {
      const ca = await readFile(caPath, 'utf8');
      return {
        ok: true,
        ca,
        source: 'path',
        path: caPath,
        bytes: Buffer.byteLength(ca),
      };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to read caPath "${caPath}": ${errorMessage(error)}`,
      };
    }
  }

  return {
    ok: true,
    ca: undefined,
    source: null,
    path: null,
    bytes: null,
  };
}
