import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Scope } from './scope';

export interface ApiKey {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly publicId: string;
  readonly secretHash: string;
  readonly scopes: readonly Scope[];
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface IssuedApiKey {
  readonly publicId: string;
  readonly secretHash: string;
  /** Shown once at creation time and never recoverable afterwards. */
  readonly token: string;
}

const TOKEN_PATTERN = /^hk_(live|test)_([0-9a-f]{16})_([A-Za-z0-9_-]{32,64})$/;

/**
 * Tokens are presented as `hk_<mode>_<public id>_<secret>`.
 *
 * The public id makes authentication a single indexed lookup, which keeps the hot path cheap and
 * avoids comparing the presented secret against every stored key. The secret itself has 256 bits
 * of entropy, so a SHA-256 digest is the right store: a password hash would only add latency
 * without defending against a dictionary that cannot exist.
 */
export const apiKeyToken = {
  issue(mode: 'live' | 'test' = 'live'): IssuedApiKey {
    const publicId = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    return {
      publicId,
      secretHash: hashSecret(secret),
      token: `hk_${mode}_${publicId}_${secret}`,
    };
  },

  parse(token: string): { publicId: string; secret: string } | null {
    const match = TOKEN_PATTERN.exec(token.trim());
    if (!match) return null;
    const [, , publicId, secret] = match;
    if (!publicId || !secret) return null;
    return { publicId, secret };
  },

  matches(secret: string, storedHash: string): boolean {
    const presented = Buffer.from(hashSecret(secret), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return presented.length === stored.length && timingSafeEqual(presented, stored);
  },
};

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
