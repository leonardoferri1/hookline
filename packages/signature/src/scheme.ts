import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Hookline signs every request with a versioned, timestamped HMAC so consumers can reject
 * tampered payloads and replays without trusting transport metadata.
 *
 *   Hookline-Signature: t=1760880000,v1=9f86d08...,v1=0a1b2c3...
 *
 * The signed string is `${timestamp}.${rawBody}`, which binds the timestamp to the payload: an
 * attacker cannot move a captured signature to a fresh timestamp. During a secret rotation the
 * header carries one `v1` entry per active secret, so consumers can adopt the new secret before
 * the old one is retired.
 */
export const SIGNATURE_HEADER = 'hookline-signature';
export const SIGNATURE_VERSION = 'v1';
export const SECRET_PREFIX = 'whsec_';
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailureReason =
  | 'missing_header'
  | 'malformed_header'
  | 'missing_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'no_signature_match';

export type SignatureVerification =
  { valid: true; timestamp: number } | { valid: false; reason: SignatureFailureReason };

export interface SignatureHeaderInput {
  payload: string;
  secrets: readonly string[];
  timestamp: number;
}

export interface SignatureVerifyInput {
  payload: string;
  header: string | undefined;
  secrets: readonly string[];
  /** Maximum accepted age of the signature, in seconds. */
  toleranceSeconds?: number;
  /** Injected for deterministic tests; defaults to the current wall clock. */
  nowSeconds?: number;
}

/** Generates a shared secret with a recognizable prefix, mirroring common provider conventions. */
export function generateSigningSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function signPayload(payload: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
}

export function buildSignatureHeader({
  payload,
  secrets,
  timestamp,
}: SignatureHeaderInput): string {
  if (secrets.length === 0) throw new Error('At least one signing secret is required.');
  const signatures = secrets.map(
    (secret) => `${SIGNATURE_VERSION}=${signPayload(payload, secret, timestamp)}`,
  );
  return [`t=${timestamp}`, ...signatures].join(',');
}

/** Compares two hex digests without leaking their contents through timing differences. */
function digestsMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  } catch {
    return false;
  }
}

function parseHeader(header: string): { timestamp?: string; signatures: string[] } {
  const signatures: string[] = [];
  let timestamp: string | undefined;
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') timestamp ??= value;
    else if (key === SIGNATURE_VERSION) signatures.push(value);
  }
  return { timestamp, signatures };
}

export function verifySignature({
  payload,
  header,
  secrets,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
}: SignatureVerifyInput): SignatureVerification {
  if (!header) return { valid: false, reason: 'missing_header' };
  const { timestamp, signatures } = parseHeader(header);
  if (!timestamp) return { valid: false, reason: 'missing_timestamp' };
  if (signatures.length === 0) return { valid: false, reason: 'malformed_header' };
  const signedAt = Number(timestamp);
  if (!Number.isInteger(signedAt)) return { valid: false, reason: 'missing_timestamp' };
  if (Math.abs(nowSeconds - signedAt) > toleranceSeconds)
    return { valid: false, reason: 'timestamp_out_of_tolerance' };
  for (const secret of secrets) {
    const expected = signPayload(payload, secret, signedAt);
    if (signatures.some((candidate) => digestsMatch(candidate, expected)))
      return { valid: true, timestamp: signedAt };
  }
  return { valid: false, reason: 'no_signature_match' };
}
