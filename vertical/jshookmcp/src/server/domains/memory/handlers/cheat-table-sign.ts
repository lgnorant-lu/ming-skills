/**
 * Cheat Table cryptographic signing (CE 7.6 parity).
 *
 * Pure TS, uses Node.js crypto. HMAC-SHA256 with a secret sourced from
 * state_board (namespace "memory_ct_sign") or env var JSHOOK_TABLE_SECRET.
 *
 * This is a lightweight attribution mechanism, not a security guarantee —
 * the signature proves the table was exported by someone who knows the
 * shared secret, but does not prevent tampering (the XML is plaintext).
 */

import * as crypto from 'node:crypto';
import { readEnvNullableString } from '@src/config/environment';

const ALGORITHM = 'sha256';
const SIGNATURE_ELEMENT = 'Signature';

interface SignResult {
  success: boolean;
  signedXml?: string;
  signature?: string;
  entryCount: number;
  timestamp: number;
  signer?: string;
  error?: string;
}

interface VerifyResult {
  valid: boolean;
  signer?: string;
  timestamp?: number;
  error?: string;
}

/**
 * Extract the secret from env or state_board.
 * Falls back gracefully — if no secret is configured, returns undefined
 * and sign/verify will produce clear errors.
 */
async function resolveSecret(args: Record<string, unknown>): Promise<string | undefined> {
  // 1. Explicit secret in args (highest priority)
  if (typeof args.secret === 'string' && args.secret.length > 0) {
    return args.secret;
  }

  // 2. Environment variable
  const envSecret = readEnvNullableString('JSHOOK_TABLE_SECRET');
  if (envSecret && envSecret.length > 0) {
    return envSecret;
  }

  // 3. state_board lookup (lazy — only if state_board functions are available)
  // eslint-disable-next-line no-underscore-dangle
  const getStateBoard = args._stateBoardGet as
    | ((ns: string, key: string) => Promise<string | undefined>)
    | undefined;
  if (getStateBoard) {
    try {
      const stored = await getStateBoard('memory_ct_sign', 'secret');
      if (stored && stored.length > 0) return stored;
    } catch {
      // state_board not available — fall through
    }
  }

  return undefined;
}

/**
 * Sign a Cheat Engine .CT XML string with HMAC-SHA256.
 *
 * The signature is embedded as a <Signature> element before the closing
 * </CheatTable> tag. The XML between <CheatTable> and </CheatTable>
 * (exclusive) is signed.
 */
export async function signCheatTable(
  xml: string,
  args: Record<string, unknown>,
): Promise<SignResult> {
  const secret = await resolveSecret(args);
  if (!secret) {
    return {
      success: false,
      entryCount: 0,
      timestamp: Date.now(),
      error:
        'No signing secret configured. Set JSHOOK_TABLE_SECRET env var, ' +
        'pass "secret" argument, or store via state_board namespace "memory_ct_sign" key "secret".',
    };
  }

  const signer =
    typeof args.signer === 'string' && args.signer.length > 0 ? args.signer : 'jshookmcp';

  // Extract the inner content of <CheatTable>...</CheatTable>
  const ctMatch = xml.match(/<CheatTable[^>]*>([\s\S]*)<\/CheatTable>/i);
  if (!ctMatch) {
    return {
      success: false,
      entryCount: 0,
      timestamp: Date.now(),
      error: 'Invalid CT XML: missing <CheatTable> root element',
    };
  }

  const innerXml = ctMatch[1]!;
  const timestamp = Date.now();
  const payload = `${signer}:${timestamp}:${innerXml}`;
  const hmac = crypto.createHmac(ALGORITHM, secret);
  hmac.update(payload);
  const signature = hmac.digest('hex');

  // Count entries for reporting
  const entryMatches = xml.match(/<CheatEntry>/gi);
  const entryCount = entryMatches ? entryMatches.length : 0;

  // Embed signature before closing </CheatTable>
  const sigElement = `  <${SIGNATURE_ELEMENT} signer="${escapeXml(signer)}" timestamp="${timestamp}" hash="${signature}"/>`;
  const signedXml = xml.replace(/<\/CheatTable>/i, `${sigElement}\n</CheatTable>`);

  return {
    success: true,
    signedXml,
    signature,
    entryCount,
    timestamp,
    signer,
  };
}

/**
 * Verify a signed Cheat Engine .CT XML string.
 *
 * Extracts the <Signature> element, recomputes the HMAC, and compares.
 * Returns {valid, signer, timestamp}.
 */
export async function verifyCheatTable(
  xml: string,
  args: Record<string, unknown>,
): Promise<VerifyResult> {
  const secret = await resolveSecret(args);
  if (!secret) {
    return {
      valid: false,
      error:
        'No signing secret configured. Set JSHOOK_TABLE_SECRET env var, ' +
        'pass "secret" argument, or store via state_board namespace "memory_ct_sign" key "secret".',
    };
  }

  // Extract and remove signature element
  const sigMatch = xml.match(
    /<Signature\s+signer="([^"]*)"\s+timestamp="(\d+)"\s+hash="([a-f0-9]+)"\s*\/>/i,
  );
  if (!sigMatch) {
    return {
      valid: false,
      error: 'No <Signature> element found in the cheat table XML',
    };
  }

  const signer = sigMatch[1]!;
  const timestamp = parseInt(sigMatch[2]!, 10);
  const claimedHash = sigMatch[3]!;

  // Remove the signature element to get the original inner XML
  const unsignedXml = xml.replace(
    /\s*<Signature\s+signer="[^"]*"\s+timestamp="\d+"\s+hash="[a-f0-9]+"\s*\/>/i,
    '',
  );

  const ctMatch = unsignedXml.match(/<CheatTable[^>]*>([\s\S]*)<\/CheatTable>/i);
  if (!ctMatch) {
    return {
      valid: false,
      error: 'Invalid CT XML after signature removal',
    };
  }

  const innerXml = ctMatch[1]!;
  const payload = `${signer}:${timestamp}:${innerXml}`;
  const hmac = crypto.createHmac(ALGORITHM, secret);
  hmac.update(payload);
  const computedHash = hmac.digest('hex');

  // Constant-time comparison
  const valid = crypto.timingSafeEqual(
    Buffer.from(computedHash, 'hex'),
    Buffer.from(claimedHash, 'hex'),
  );

  return {
    valid,
    signer,
    timestamp,
    error: valid ? undefined : 'HMAC mismatch — the table has been modified since signing',
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
