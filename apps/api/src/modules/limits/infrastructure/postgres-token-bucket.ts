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
 * The accepted path is one statement. Every expression in it references the row's own columns, so
 * when two requests contend on the same bucket the blocked statement re-evaluates both the
 * predicate and the new token count against the committed row version instead of a stale
 * snapshot - the property that would be lost if the refill were computed in a `FROM` subquery.
 *
 * `rowCount = 0` means either an empty bucket or a tenant whose bucket does not exist yet, which
 * the two follow-up statements tell apart. Both only run on the rejected path.
 */
@Injectable()
export class PostgresTokenBucket extends RateLimiter {
  constructor(private readonly database: Database) {
    super();
  }

  override async consume(key: string, limits: BucketLimits, cost = 1): Promise<RateLimitDecision> {
    const perSecond = limits.ratePerMinute / 60;

    const consumed = await this.database.query<{ tokens: number }>(
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
    const consumedRow = consumed.rows[0];
    if (consumedRow) return this.allow(consumedRow.tokens, limits);

    const seeded = await this.database.query<{ tokens: number }>(
      `INSERT INTO rate_buckets (tenant_id, tokens, updated_at)
       VALUES ($1, GREATEST(0, $2::double precision - $3::double precision), clock_timestamp())
       ON CONFLICT (tenant_id) DO NOTHING
       RETURNING tokens`,
      [key, limits.burst, cost],
    );
    const seededRow = seeded.rows[0];
    if (seededRow && limits.burst >= cost) return this.allow(seededRow.tokens, limits);

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
