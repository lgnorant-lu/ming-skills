/**
 * TLS keylog / boringssl-inspector configuration.
 * Prefixes: TLS_*
 */

import { str } from './helpers.js';

/** Default path for SSLKEYLOGFILE output. Override via JSHOOK_TLS_KEYLOG_PATH. */
export const TLS_KEYLOG_PATH = str('JSHOOK_TLS_KEYLOG_PATH', '/tmp/sslkeylog.log');
