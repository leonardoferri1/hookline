import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../shared/database/database.service';
import { ClaimedDelivery, CompleteDeliveryInput, DeliveryQueue } from '../domain/queue.repository';

interface ClaimRow {
  delivery_id: string;
  tenant_id: string;
  endpoint_id: string;
  endpoint_url: string;
  endpoint_name: string;
  timeout_ms: number;
  attempt: number;
  max_attempts: number;
  partition_key: string | null;
  event_id: string;
  event_type: string;
  event_payload: unknown;
  occurred_at: Date;
  signing_secrets: string[];
}

@Injectable()
export class PostgresDeliveryQueue extends DeliveryQueue {
  constructor(private readonly database: Database) {
    super();
  }

  /**
   * Claims due work for one dispatcher.
   *
   * `FOR UPDATE ... SKIP LOCKED` is what makes several dispatchers safe against each other: each
   * one takes rows nobody else holds instead of blocking, so throughput scales with workers and a
   * slow destination never stalls the whole queue.
   *
   * The `NOT EXISTS` clause implements ordering for endpoints that asked for it. A delivery waits
   * while any sibling in the same partition is in flight, and also while an *older* sibling is
   * still pending - even if that sibling is not due yet because it is backing off. Head-of-line
   * blocking is the honest cost of ordered delivery, and it is confined to one partition key.
   *
   * Endpoints that are paused, or whose breaker is open and not yet due for a probe, are left
   * alone. The lease and the attempt counter are set in the same statement that changes the state,
   * so a dispatcher that dies after claiming has already consumed an attempt: the alternative is a
   * delivery that can be retried forever by crashing at the right moment.
   */
  override async claimDue(
    workerId: string,
    batchSize: number,
    now: Date,
    leaseSeconds: number,
  ): Promise<ClaimedDelivery[]> {
    const result = await this.database.query<ClaimRow>(
      `WITH due AS (
         SELECT d.id
           FROM deliveries d
           JOIN endpoints e ON e.id = d.endpoint_id
          WHERE d.state = 'pending'
            AND d.next_attempt_at <= $2::timestamptz
            AND e.status = 'enabled'
            AND (e.circuit_state <> 'open' OR e.circuit_retry_at <= $2::timestamptz)
            AND (
              NOT e.ordered
              OR d.partition_key IS NULL
              OR NOT EXISTS (
                   SELECT 1
                     FROM deliveries blocker
                    WHERE blocker.endpoint_id = d.endpoint_id
                      AND blocker.partition_key = d.partition_key
                      AND blocker.id <> d.id
                      AND (
                        blocker.state = 'in_flight'
                        OR (blocker.state = 'pending'
                            AND (blocker.created_at, blocker.id) < (d.created_at, d.id))
                      )
                 )
            )
          ORDER BY d.next_attempt_at, d.created_at
          LIMIT $3::integer
          FOR UPDATE OF d SKIP LOCKED
       ),
       claimed AS (
         UPDATE deliveries d
            SET state = 'in_flight',
                attempt_count = d.attempt_count + 1,
                leased_by = $1::text,
                leased_until = $2::timestamptz + make_interval(secs => $4::double precision),
                first_attempt_at = COALESCE(d.first_attempt_at, $2::timestamptz),
                updated_at = now()
           FROM due
          WHERE d.id = due.id
          RETURNING d.id, d.tenant_id, d.endpoint_id, d.attempt_count, d.max_attempts,
                    d.partition_key, d.event_id
       )
       SELECT c.id              AS delivery_id,
              c.tenant_id       AS tenant_id,
              c.endpoint_id     AS endpoint_id,
              e.url             AS endpoint_url,
              e.name            AS endpoint_name,
              e.timeout_ms      AS timeout_ms,
              c.attempt_count   AS attempt,
              c.max_attempts    AS max_attempts,
              c.partition_key   AS partition_key,
              ev.id             AS event_id,
              ev.type           AS event_type,
              ev.payload        AS event_payload,
              ev.occurred_at    AS occurred_at,
              COALESCE(
                (SELECT array_agg(s.secret ORDER BY s.created_at DESC)
                   FROM endpoint_secrets s
                  WHERE s.endpoint_id = c.endpoint_id
                    AND (s.expires_at IS NULL OR s.expires_at > $2::timestamptz)),
                ARRAY[]::text[]
              )                 AS signing_secrets
         FROM claimed c
         JOIN endpoints e ON e.id = c.endpoint_id
         JOIN events ev ON ev.id = c.event_id`,
      [workerId, now, batchSize, leaseSeconds],
    );

    return result.rows.map((row) => ({
      deliveryId: row.delivery_id,
      tenantId: row.tenant_id,
      endpointId: row.endpoint_id,
      endpointUrl: row.endpoint_url,
      endpointName: row.endpoint_name,
      timeoutMs: row.timeout_ms,
      attempt: row.attempt,
      maxAttempts: row.max_attempts,
      partitionKey: row.partition_key,
      eventId: row.event_id,
      eventType: row.event_type,
      eventPayload: row.event_payload,
      occurredAt: row.occurred_at,
      signingSecrets: row.signing_secrets,
    }));
  }

  /**
   * Writes the attempt and the resulting delivery state together. If these were separate commits,
   * a crash between them would either lose the evidence of an attempt that really happened or
   * leave a delivery claiming an outcome no attempt supports.
   *
   * The attempt insert is idempotent on `(delivery_id, attempt_number)`: a retried completion
   * after a transient database error does not duplicate history.
   */
  override async complete(input: CompleteDeliveryInput): Promise<void> {
    const { attempt } = input;
    await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO delivery_attempts
           (delivery_id, tenant_id, endpoint_id, attempt_number, outcome, status_code,
            error_reason, error_message, duration_ms, request_headers, response_headers,
            response_body, response_truncated, started_at)
         SELECT $1::uuid, d.tenant_id, d.endpoint_id, $2::integer, $3::attempt_outcome,
                $4::integer, $5::text, $6::text, $7::integer, $8::jsonb, $9::jsonb,
                $10::text, $11::boolean, $12::timestamptz
           FROM deliveries d
          WHERE d.id = $1::uuid
         ON CONFLICT (delivery_id, attempt_number) DO NOTHING`,
        [
          input.deliveryId,
          input.attemptNumber,
          attempt.outcome,
          attempt.statusCode,
          attempt.errorReason,
          attempt.errorMessage,
          attempt.durationMs,
          JSON.stringify(input.requestHeaders),
          JSON.stringify(attempt.responseHeaders),
          attempt.responseBody,
          attempt.responseTruncated,
          input.startedAt,
        ],
      );

      await client.query(
        `UPDATE deliveries
            SET state = CASE
                          WHEN $2::text = 'succeeded' THEN 'succeeded'::delivery_state
                          WHEN $3::timestamptz IS NULL THEN 'failed'::delivery_state
                          ELSE 'pending'::delivery_state
                        END,
                next_attempt_at = COALESCE($3::timestamptz, next_attempt_at),
                completed_at = CASE
                                 WHEN $2::text = 'succeeded' OR $3::timestamptz IS NULL
                                   THEN $4::timestamptz
                                 ELSE NULL
                               END,
                last_status_code = $5::integer,
                last_error = $6::text,
                leased_by = NULL,
                leased_until = NULL,
                updated_at = now()
          WHERE id = $1::uuid AND state = 'in_flight'`,
        [
          input.deliveryId,
          attempt.outcome,
          input.nextAttemptAt,
          input.startedAt,
          attempt.statusCode,
          attempt.errorMessage,
        ],
      );
    });
  }

  override async recoverExpiredLeases(now: Date, client?: Queryable): Promise<number> {
    const result = await this.database.with(client).query(
      `UPDATE deliveries
          SET state = CASE
                        WHEN attempt_count >= max_attempts THEN 'failed'::delivery_state
                        ELSE 'pending'::delivery_state
                      END,
              completed_at = CASE
                               WHEN attempt_count >= max_attempts THEN $1::timestamptz
                               ELSE NULL
                             END,
              last_error = COALESCE(last_error, 'The dispatcher lease expired before an outcome was recorded.'),
              next_attempt_at = $1::timestamptz,
              leased_by = NULL,
              leased_until = NULL,
              updated_at = now()
        WHERE state = 'in_flight' AND leased_until < $1::timestamptz`,
      [now],
    );
    return result.rowCount ?? 0;
  }

  override async countPending(tenantId: string, now: Date): Promise<number> {
    const result = await this.database.query<{ total: string }>(
      `SELECT count(*) AS total
         FROM deliveries
        WHERE tenant_id = $1::uuid AND state = 'pending' AND next_attempt_at <= $2::timestamptz`,
      [tenantId, now],
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}
