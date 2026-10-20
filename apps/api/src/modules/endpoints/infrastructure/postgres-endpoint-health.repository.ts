import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../shared/database/database.service';
import { CircuitState } from '../domain/endpoint';
import {
  BreakerSettings,
  EndpointHealthRepository,
  HealthTransition,
} from '../domain/endpoint-health.repository';

interface HealthRow {
  id: string;
  previous_state: CircuitState;
  circuit_state: CircuitState;
  consecutive_failures: number;
  circuit_opened_at: Date | null;
  circuit_retry_at: Date | null;
  last_success_at: Date | null;
  last_failure_at: Date | null;
}

const RETURNING = `id,
  circuit_state, consecutive_failures, circuit_opened_at, circuit_retry_at,
  last_success_at, last_failure_at`;

@Injectable()
export class PostgresEndpointHealthRepository extends EndpointHealthRepository {
  constructor(private readonly database: Database) {
    super();
  }

  /** A single success closes the breaker: the destination answered, so there is nothing to protect. */
  override async recordSuccess(
    endpointId: string,
    at: Date,
    client?: Queryable,
  ): Promise<HealthTransition | null> {
    const result = await this.database.with(client).query<HealthRow>(
      // The `current` CTE reads the pre-update snapshot, which is what makes "did the breaker
      // just close?" answerable in one round trip.
      `WITH current AS (
         SELECT circuit_state AS previous_state FROM endpoints WHERE id = $1::uuid
       ),
       updated AS (
         UPDATE endpoints
            SET circuit_state = 'closed',
                consecutive_failures = 0,
                circuit_opened_at = NULL,
                circuit_retry_at = NULL,
                last_success_at = $2::timestamptz,
                updated_at = now()
          WHERE id = $1::uuid
          RETURNING ${RETURNING}
       )
       SELECT current.previous_state, updated.* FROM updated CROSS JOIN current`,
      [endpointId, at],
    );
    return toTransition(result.rows[0]);
  }

  /**
   * Increments the failure count and opens the breaker in the same statement.
   *
   * The cooldown doubles for each failure past the threshold, capped - the SQL mirror of
   * `cooldownSeconds` in the dispatch domain. Computing it here rather than in the application is
   * what keeps the counter atomic when two dispatchers fail against the same endpoint at once.
   *
   * `circuit_opened_at` is preserved with COALESCE so the console can show how long a destination
   * has been down, rather than how long since the last probe.
   */
  override async recordFailure(
    endpointId: string,
    at: Date,
    settings: BreakerSettings,
    client?: Queryable,
  ): Promise<HealthTransition | null> {
    const result = await this.database.with(client).query<HealthRow>(
      `WITH current AS (
         SELECT circuit_state AS previous_state FROM endpoints WHERE id = $1::uuid
       ),
       updated AS (
         UPDATE endpoints e
            SET consecutive_failures = e.consecutive_failures + 1,
                last_failure_at = $2::timestamptz,
                circuit_state = CASE
                                  WHEN e.circuit_state <> 'closed'
                                    OR e.consecutive_failures + 1 >= $3::integer
                                    THEN 'open'::circuit_state
                                  ELSE e.circuit_state
                                END,
                circuit_opened_at = CASE
                                      WHEN e.circuit_state <> 'closed'
                                        OR e.consecutive_failures + 1 >= $3::integer
                                        THEN COALESCE(e.circuit_opened_at, $2::timestamptz)
                                      ELSE e.circuit_opened_at
                                    END,
                circuit_retry_at = CASE
                                     WHEN e.circuit_state <> 'closed'
                                       OR e.consecutive_failures + 1 >= $3::integer
                                       THEN $2::timestamptz + make_interval(secs =>
                                              LEAST(
                                                $5::double precision,
                                                $4::double precision
                                                  * power(2, GREATEST(0, e.consecutive_failures + 1 - $3::integer))
                                              ))
                                     ELSE e.circuit_retry_at
                                   END,
                updated_at = now()
          WHERE e.id = $1::uuid
          RETURNING ${RETURNING}
       )
       SELECT current.previous_state, updated.* FROM updated CROSS JOIN current`,
      [
        endpointId,
        at,
        settings.failureThreshold,
        settings.baseCooldownSeconds,
        settings.maxCooldownSeconds,
      ],
    );
    return toTransition(result.rows[0]);
  }
}

function toTransition(row: HealthRow | undefined): HealthTransition | null {
  if (!row) return null;
  const previousState = row.previous_state;
  return {
    endpointId: row.id,
    previous: previousState,
    changed: previousState !== row.circuit_state,
    health: {
      circuitState: row.circuit_state,
      consecutiveFailures: row.consecutive_failures,
      circuitOpenedAt: row.circuit_opened_at,
      circuitRetryAt: row.circuit_retry_at,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
    },
  };
}
