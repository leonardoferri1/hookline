export interface BackoffPolicy {
  readonly baseSeconds: number;
  readonly factor: number;
  readonly maxSeconds: number;
  /** Fraction of the computed delay that is randomized, between 0 and 1. */
  readonly jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseSeconds: 5,
  factor: 3,
  maxSeconds: 3600,
  jitter: 0.5,
};

/**
 * Exponential backoff with equal jitter: half the delay is fixed and half is random.
 *
 * Jitter matters more here than in a typical client. When a destination comes back after an
 * outage, every delivery queued against it is due at almost the same instant; without jitter they
 * would arrive as one spike and knock it over again. Keeping half the delay deterministic means
 * the schedule is still something an operator can reason about: attempt 3 of a default endpoint
 * lands between 22 and 45 seconds after attempt 2, not somewhere in the next hour.
 *
 * `random` is injected so the schedule can be asserted exactly in tests.
 */
export function nextDelaySeconds(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const uncapped = policy.baseSeconds * policy.factor ** exponent;
  const capped = Math.min(uncapped, policy.maxSeconds);
  const fixed = capped * (1 - policy.jitter);
  const variable = capped * policy.jitter * random();
  return Math.min(policy.maxSeconds, Math.round((fixed + variable) * 1000) / 1000);
}

/**
 * A destination that answers 429 or 503 with `Retry-After` is telling the sender when to come
 * back. Honouring it beats guessing, so the header wins over the computed delay - clamped to the
 * policy ceiling so a hostile or broken value cannot park a delivery for a week.
 */
export function parseRetryAfter(
  value: string | undefined,
  now: Date,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return clamp(Number(trimmed), policy);

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  return clamp((asDate - now.getTime()) / 1000, policy);
}

function clamp(seconds: number, policy: BackoffPolicy): number {
  return Math.min(policy.maxSeconds, Math.max(0, Math.round(seconds)));
}
