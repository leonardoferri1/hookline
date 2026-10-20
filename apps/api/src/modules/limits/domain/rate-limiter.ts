export interface BucketLimits {
  /** Maximum tokens the bucket may hold. */
  readonly burst: number;
  /** Tokens restored per minute. */
  readonly ratePerMinute: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Tokens left after this decision, rounded down. */
  readonly remaining: number;
  /** Seconds until the bucket holds enough tokens for another request of the same cost. */
  readonly retryAfterSeconds: number;
  readonly limits: BucketLimits;
}

/**
 * Port for the ingest quota. Keeping it abstract lets the HTTP layer depend on the decision rather
 * than on PostgreSQL, and lets tests substitute a deterministic limiter.
 */
export abstract class RateLimiter {
  abstract consume(key: string, limits: BucketLimits, cost?: number): Promise<RateLimitDecision>;
}

/** Seconds until `cost` tokens are available again, given the current level and refill rate. */
export function secondsUntilAvailable(
  available: number,
  cost: number,
  ratePerMinute: number,
): number {
  if (available >= cost) return 0;
  const perSecond = ratePerMinute / 60;
  return Math.max(1, Math.ceil((cost - available) / perSecond));
}
