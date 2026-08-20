/**
 * BoringsslInspectorTlsProbeHandlers — active TLS probe handler.
 */

import { isIP } from 'node:net';
import { checkServerIdentity, connect as createTlsConnection } from 'node:tls';
import {
  argBool,
  argEnum,
  argNumber,
  argString,
  argStringArray,
} from '@server/domains/shared/parse-args';
import type { ProbeTlsVersion } from './shared';
import {
  applyTlsValidationPolicy,
  buildPeerCertificateChain,
  errorMessage,
  hasPeerCertificate,
  loadProbeCaBundle,
  normalizeAlpnProtocol,
  normalizeSocketServername,
  TLS_VERSION_SET,
  validateNetworkTarget,
} from './shared';
import { BoringsslInspectorTlsHandlers } from './tls-handlers';

const TLS_VERSION_ORDER: ProbeTlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];

export class BoringsslInspectorTlsProbeHandlers extends BoringsslInspectorTlsHandlers {
  async handleTlsProbeEndpoint(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host')?.trim() ?? null;
    if (!host) {
      return { ok: false, error: 'host is required' };
    }

    const port = argNumber(args, 'port') ?? 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const allowInvalidCertificates = argBool(args, 'allowInvalidCertificates') ?? false;
    const skipHostnameCheck = argBool(args, 'skipHostnameCheck') ?? false;
    const servernameArg = argString(args, 'servername')?.trim() ?? null;
    const alpnProtocols = [
      ...new Set(argStringArray(args, 'alpnProtocols').map((v) => v.trim())),
    ].filter((v) => v.length > 0);

    let minVersion: ProbeTlsVersion | undefined;
    let maxVersion: ProbeTlsVersion | undefined;
    try {
      minVersion = argEnum(args, 'minVersion', TLS_VERSION_SET);
      maxVersion = argEnum(args, 'maxVersion', TLS_VERSION_SET);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    if (
      minVersion &&
      maxVersion &&
      TLS_VERSION_ORDER.indexOf(minVersion) > TLS_VERSION_ORDER.indexOf(maxVersion)
    ) {
      return { ok: false, error: 'minVersion must not be greater than maxVersion' };
    }

    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) {
      return ssrfCheck;
    }

    const caBundle = await loadProbeCaBundle(args);
    if (!caBundle.ok) {
      return { ok: false, error: caBundle.error };
    }

    const validationTarget = servernameArg ?? host;
    const requestedServername = servernameArg ?? (isIP(host) === 0 ? host : undefined);
    const startedAt = Date.now();

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const socket = createTlsConnection(
        applyTlsValidationPolicy(
          {
            host,
            port,
            servername: requestedServername,
            ...(minVersion ? { minVersion } : {}),
            ...(maxVersion ? { maxVersion } : {}),
            ...(alpnProtocols.length > 0 ? { ALPNProtocols: alpnProtocols } : {}),
            ...(caBundle.ca ? { ca: caBundle.ca } : {}),
          },
          allowInvalidCertificates,
        ),
      );

      const finish = (payload: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        resolve(payload);
      };

      const timer = setTimeout(() => {
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: 'TLS probe timed out',
          target: {
            host,
            port,
            requestedServername: requestedServername ?? null,
            validationTarget,
          },
          policy: {
            allowInvalidCertificates,
            skipHostnameCheck,
            timeoutMs,
            minVersion: minVersion ?? null,
            maxVersion: maxVersion ?? null,
            alpnProtocols,
            customCa: {
              source: caBundle.source,
              path: caBundle.path,
              bytes: caBundle.bytes,
            },
          },
        });
      }, timeoutMs);

      socket.once('error', (error: NodeJS.ErrnoException) => {
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: error.message,
          errorCode: error.code ?? null,
          target: {
            host,
            port,
            requestedServername: requestedServername ?? null,
            validationTarget,
          },
          policy: {
            allowInvalidCertificates,
            skipHostnameCheck,
            timeoutMs,
            minVersion: minVersion ?? null,
            maxVersion: maxVersion ?? null,
            alpnProtocols,
            customCa: {
              source: caBundle.source,
              path: caBundle.path,
              bytes: caBundle.bytes,
            },
          },
        });
      });

      socket.once('secureConnect', () => {
        const handshakeMs = Date.now() - startedAt;
        const peerCertificate = socket.getPeerCertificate(true);
        const hasLeafCertificate = hasPeerCertificate(peerCertificate);
        const certificateChain = hasLeafCertificate
          ? buildPeerCertificateChain(peerCertificate)
          : [];
        const leafCertificate = certificateChain[0] ?? null;
        const hostnameError =
          skipHostnameCheck || !hasLeafCertificate
            ? undefined
            : checkServerIdentity(validationTarget, peerCertificate);
        const hostnameValidation = {
          checked: !skipHostnameCheck,
          target: skipHostnameCheck ? null : validationTarget,
          matched: skipHostnameCheck ? null : hostnameError === undefined,
          error:
            !skipHostnameCheck && !hasLeafCertificate
              ? 'Peer certificate was not presented by the server'
              : (hostnameError?.message ?? null),
        };

        const authorizationReasons = [
          socket.authorized
            ? 'Certificate chain validated against the active trust store.'
            : `Certificate chain validation failed: ${socket.authorizationError ?? 'unknown_authority'}`,
          skipHostnameCheck
            ? 'Hostname validation was skipped by request.'
            : hostnameValidation.matched
              ? 'Hostname validation passed.'
              : `Hostname validation failed: ${hostnameValidation.error ?? 'unknown_error'}`,
          !socket.authorized && allowInvalidCertificates
            ? 'Policy allowed the probe to continue despite certificate trust failure.'
            : null,
        ].filter((reason): reason is string => Boolean(reason));

        const cipher = socket.getCipher();
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: true,
          timestamp: new Date().toISOString(),
        });

        finish({
          ok: true,
          target: {
            host,
            port,
            requestedServername: requestedServername ?? null,
            validationTarget,
          },
          policy: {
            allowInvalidCertificates,
            skipHostnameCheck,
            timeoutMs,
            minVersion: minVersion ?? null,
            maxVersion: maxVersion ?? null,
            alpnProtocols,
            customCa: {
              source: caBundle.source,
              path: caBundle.path,
              bytes: caBundle.bytes,
            },
          },
          transport: {
            protocol: socket.getProtocol() ?? null,
            alpnProtocol: normalizeAlpnProtocol(socket.alpnProtocol),
            cipher: {
              name: cipher.name,
              standardName: cipher.standardName,
              version: cipher.version,
            },
            localAddress: socket.localAddress ?? null,
            localPort: socket.localPort ?? null,
            remoteAddress: socket.remoteAddress ?? null,
            remotePort: socket.remotePort ?? null,
            servernameSent: normalizeSocketServername(socket.servername),
            sessionReused: socket.isSessionReused(),
          },
          authorization: {
            socketAuthorized: socket.authorized,
            authorizationError:
              typeof socket.authorizationError === 'string'
                ? socket.authorizationError
                : (socket.authorizationError?.message ?? null),
            hostnameValidation,
            policyAllowed:
              (socket.authorized || allowInvalidCertificates) &&
              (skipHostnameCheck || hostnameValidation.matched === true),
            reasons: authorizationReasons,
          },
          certificates: {
            leaf: leafCertificate,
            chain: certificateChain,
          },
          timing: {
            handshakeMs,
          },
        });
      });
    });
  }
}
