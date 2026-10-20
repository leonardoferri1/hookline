import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/database/database.service';
import {
  BucketLimits,
  RateLimitDecision,
  RateLimiter,
  secondsUntilAvailable,
} from '../domain/rate-limiter';

/**
 * Token bucket backed by a single row per tenant.
 *
 * The accepted path is a single statement; the extra statements that create a missing bucket or
 * work out when to come back only run when the first one changes nothing.
 */
@Injectable()
export class PostgresTokenBucket extends RateLimiter {
  constructor(private readonly database: Database) {
    super();
  }

  override async consume(key: string, limits: BucketLimits, cost = 1): Promise<RateLimitDecision> {
    const consumed = await this.tryConsume(key, limits, cost);
    if (consumed !== null) return this.allow(consumed, limits);

    /*
     * No row was updated, which means either an empty bucket or a tenant whose bucket does not
     * exist yet. Creating it can lose a race with a concurrent first request, and `DO NOTHING`
     * then returns nothing - so the consume is retried rather than treated as a refusal. Without
     * that retry, a tenant's very first burst of parallel requests would see spurious 429s.
     */
    const seeded = await this.database.query<{ tokens: number }>(
      `INSERT INTO rate_buckets (tenant_id, tokens, updated_at)
       VALUES ($1, GREATEST(0, $2::double precision - $3::double precision), clock_timestamp())
       ON CONFLICT (tenant_id) DO NOTHING
       RETURNING tokens`,
      [key, limits.burst, cost],
    );
    const seededRow = seeded.rows[0];
    if (seededRow && limits.burst >= cost) return this.allow(seededRow.tokens, limits);

    const retried = await this.tryConsume(key, limits, cost);
    if (retried !== null) return this.allow(retried, limits);

    return this.refuse(key, limits, cost);
  }

  /**
   * The accepted path, in one statement.
   *
   * Every expression references the row's own columns, so when two requests contend on the same
   * bucket the blocked statement re-evaluates both the predicate and the new token count against
   * the committed row version instead of a stale snapshot - the property that would be lost if the
   * refill were computed in a `FROM` subquery. Returns null when nothing was updated.
   */
  private async tryConsume(
    key: string,
    limits: BucketLimits,
    cost: number,
  ): Promise<number | null> {
    const perSecond = limits.ratePerMinute / 60;
    const result = await this.database.query<{ tokens: number }>(
      `UPDATE rate_buckets
          SET tokens = LEAST($2::double precision,
                             tokens + EXTRACT(EPOCH FROM (clock_timestamp() - updated_at)) * $3::double precision)
                        - $4::double precision,
              updated_at = clock_timestamp()
        WHERE tenant_id = $1
          AND LEAST($2::double precision,
                    tokens + EXTRACT(EPOCH FROM (clock_timestamp() - updated_at)) * $3::double precision)
              >= $4::double precision
        RETURNING tokens`,
      [key, limits.burst, perSecond, cost],
    );
    return result.rows[0]?.tokens ?? null;
  }

  /** Reads the current level only to say how long the caller should wait. */
  private async refuse(
    key: string,
    limits: BucketLimits,
    cost: number,
  ): Promise<RateLimitDecision> {
    const perSecond = limits.ratePerMinute / 60;
    const current = await this.database.query<{ available: number }>(
      `SELECT LEAST($2::double precision,
                    tokens + EXTRACT(EPOCH FROM (clock_timestamp() - updated_at)) * $3::double precision)
                AS available
         FROM rate_buckets
        WHERE tenant_id = $1`,
      [key, limits.burst, perSecond],
    );
    const available = current.rows[0]?.available ?? 0;
    return {
      allowed: false,
      remaining: Math.floor(available),
      retryAfterSeconds: secondsUntilAvailable(available, cost, limits.ratePerMinute),
      limits,
    };
  }

  private allow(tokens: number, limits: BucketLimits): RateLimitDecision {
    return {
      allowed: true,
      remaining: Math.floor(tokens),
      retryAfterSeconds: 0,
      limits,
    };
  }
}
