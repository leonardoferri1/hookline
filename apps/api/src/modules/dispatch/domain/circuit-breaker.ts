export interface BreakerPolicy {
  /** Consecutive failures that trip a closed breaker. */
  readonly failureThreshold: number;
  /** Cooldown applied the first time the breaker opens, in seconds. */
  readonly baseCooldownSeconds: number;
  /** Ceiling for the cooldown, however long the destination stays down. */
  readonly maxCooldownSeconds: number;
}

export const DEFAULT_BREAKER: BreakerPolicy = {
  failureThreshold: 5,
  baseCooldownSeconds: 30,
  maxCooldownSeconds: 600,
};

/**
 * Cooldown for a breaker that has just failed `consecutiveFailures` times in a row.
 *
 * The cooldown doubles past the threshold, so a destination that is down for an hour is probed
 * every ten minutes rather than every thirty seconds, while one that blips is retried quickly.
 *
 * This formula is mirrored by the `UPDATE` in `postgres-endpoint-health.repository.ts`, which has
 * to compute it in SQL to keep the failure count atomic across dispatchers. The duplication is
 * deliberate and this function is the reference the tests pin.
 */
export function cooldownSeconds(
  consecutiveFailures: number,
  policy: BreakerPolicy = DEFAULT_BREAKER,
): number {
  const overshoot = Math.max(0, consecutiveFailures - policy.failureThreshold);
  const cooldown = policy.baseCooldownSeconds * 2 ** overshoot;
  return Math.min(policy.maxCooldownSeconds, cooldown);
}

/**
 * Whether this failure leaves the breaker open.
 *
 * A failure while probing re-opens immediately: the probe exists precisely to answer whether the
 * destination recovered, and one failed answer is enough.
 */
export function opensAfterFailure(
  current: 'closed' | 'open' | 'half_open',
  consecutiveFailures: number,
  policy: BreakerPolicy = DEFAULT_BREAKER,
): boolean {
  if (current !== 'closed') return true;
  return consecutiveFailures >= policy.failureThreshold;
}
