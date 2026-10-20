import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/database/database.service';
import {
  AttemptTotals,
  EndpointMetrics,
  LatencySummary,
  QueueDepth,
  TimelineBucket,
  errorRateOf,
} from '../domain/metrics';
import { MetricsQuery, MetricsRepository } from '../domain/metrics.repository';

/**
 * Metrics are derived from the attempt log, not from counters maintained alongside it.
 *
 * A counter can drift from the rows it is supposed to summarize, and reconciling it is work that
 * never ends. Aggregating the source of truth on read means the numbers cannot disagree with the
 * history an operator is looking at, and PostgreSQL does the aggregation well: `percentile_cont`
 * for latency, `FILTER` for the outcome split, and a generated bucket series so a quiet minute
 * shows as a zero rather than as a gap.
 *
 * The honest limit is scale. These queries read every attempt in the window, which is correct for
 * this project's volume; a deployment with millions of attempts a day would roll the same
 * expressions into per-minute aggregates and read those instead. The query shape would not change.
 */
@Injectable()
export class PostgresMetricsRepository extends MetricsRepository {
  constructor(private readonly database: Database) {
    super();
  }

  override async totals(query: MetricsQuery): Promise<AttemptTotals> {
    const result = await this.database.query<{
      attempts: string;
      succeeded: string;
      rejected: string;
      transport_errors: string;
    }>(
      `SELECT count(*) AS attempts,
              count(*) FILTER (WHERE outcome = 'succeeded') AS succeeded,
              count(*) FILTER (WHERE outcome = 'rejected') AS rejected,
              count(*) FILTER (WHERE outcome = 'transport_error') AS transport_errors
         FROM delivery_attempts
        WHERE tenant_id = $1::uuid
          AND started_at >= $2::timestamptz
          AND started_at < $3::timestamptz
          AND ($4::uuid IS NULL OR endpoint_id = $4::uuid)`,
      [query.tenantId, query.from, query.to, query.endpointId ?? null],
    );
    return toTotals(result.rows[0]);
  }

  override async latency(query: MetricsQuery): Promise<LatencySummary> {
    const result = await this.database.query<{
      answered: string;
      p50: number | null;
      p95: number | null;
      p99: number | null;
      max: number | null;
    }>(
      // `status_code IS NOT NULL` is exactly "the destination answered": the schema guarantees a
      // status code is present unless the outcome was a transport error.
      `SELECT count(*) AS answered,
              percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
              percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99,
              max(duration_ms) AS max
         FROM delivery_attempts
        WHERE tenant_id = $1::uuid
          AND started_at >= $2::timestamptz
          AND started_at < $3::timestamptz
          AND ($4::uuid IS NULL OR endpoint_id = $4::uuid)
          AND status_code IS NOT NULL`,
      [query.tenantId, query.from, query.to, query.endpointId ?? null],
    );
    const row = result.rows[0];
    return {
      answeredAttempts: Number(row?.answered ?? 0),
      p50Ms: round(row?.p50),
      p95Ms: round(row?.p95),
      p99Ms: round(row?.p99),
      maxMs: round(row?.max),
    };
  }

  override async queueDepth(tenantId: string, now: Date): Promise<QueueDepth> {
    const result = await this.database.query<{
      pending: string;
      due_now: string;
      in_flight: string;
      failed: string;
    }>(
      `SELECT count(*) FILTER (WHERE state = 'pending') AS pending,
              count(*) FILTER (WHERE state = 'pending' AND next_attempt_at <= $2::timestamptz) AS due_now,
              count(*) FILTER (WHERE state = 'in_flight') AS in_flight,
              count(*) FILTER (WHERE state = 'failed') AS failed
         FROM deliveries
        WHERE tenant_id = $1::uuid`,
      [tenantId, now],
    );
    const row = result.rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      dueNow: Number(row?.due_now ?? 0),
      inFlight: Number(row?.in_flight ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }

  /**
   * Starts from `endpoints` with a LEFT JOIN so a destination with no traffic in the window still
   * appears - an endpoint that has gone silent is exactly what an operator wants to notice.
   */
  override async perEndpoint(query: MetricsQuery): Promise<EndpointMetrics[]> {
    const result = await this.database.query<{
      endpoint_id: string;
      name: string;
      status: string;
      circuit_state: string;
      consecutive_failures: number;
      last_success_at: Date | null;
      last_failure_at: Date | null;
      attempts: string;
      succeeded: string;
      rejected: string;
      transport_errors: string;
      p95: number | null;
    }>(
      `SELECT e.id AS endpoint_id,
              e.name,
              e.status::text AS status,
              e.circuit_state::text AS circuit_state,
              e.consecutive_failures,
              e.last_success_at,
              e.last_failure_at,
              count(a.id) AS attempts,
              count(a.id) FILTER (WHERE a.outcome = 'succeeded') AS succeeded,
              count(a.id) FILTER (WHERE a.outcome = 'rejected') AS rejected,
              count(a.id) FILTER (WHERE a.outcome = 'transport_error') AS transport_errors,
              percentile_cont(0.95) WITHIN GROUP (
                ORDER BY a.duration_ms
              ) FILTER (WHERE a.status_code IS NOT NULL) AS p95
         FROM endpoints e
         LEFT JOIN delivery_attempts a
                ON a.endpoint_id = e.id
               AND a.started_at >= $2::timestamptz
               AND a.started_at < $3::timestamptz
        WHERE e.tenant_id = $1::uuid
          AND ($4::uuid IS NULL OR e.id = $4::uuid)
        GROUP BY e.id, e.name, e.status, e.circuit_state, e.consecutive_failures,
                 e.last_success_at, e.last_failure_at
        ORDER BY count(a.id) DESC, e.name`,
      [query.tenantId, query.from, query.to, query.endpointId ?? null],
    );
    return result.rows.map((row) => ({
      endpointId: row.endpoint_id,
      name: row.name,
      status: row.status,
      circuitState: row.circuit_state,
      consecutiveFailures: row.consecutive_failures,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      totals: toTotals(row),
      p95Ms: round(row.p95),
    }));
  }

  /**
   * Buckets are generated first and the attempts joined into them, so an interval with no traffic
   * comes back as a zero. A client should not have to guess whether a missing bucket means "no
   * deliveries" or "no data".
   */
  override async timeline(query: MetricsQuery): Promise<TimelineBucket[]> {
    const result = await this.database.query<{
      bucket_start: Date;
      attempts: string;
      succeeded: string;
      failed: string;
      p95: number | null;
    }>(
      `WITH span AS (
         SELECT to_timestamp(
                  floor(extract(epoch FROM $2::timestamptz) / $4::double precision)
                  * $4::double precision
                ) AS aligned_from
       ),
       buckets AS (
         SELECT generate_series(
                  (SELECT aligned_from FROM span),
                  $3::timestamptz,
                  make_interval(secs => $4::double precision)
                ) AS bucket_start
       )
       SELECT b.bucket_start,
              count(a.id) AS attempts,
              count(a.id) FILTER (WHERE a.outcome = 'succeeded') AS succeeded,
              count(a.id) FILTER (WHERE a.outcome <> 'succeeded') AS failed,
              percentile_cont(0.95) WITHIN GROUP (
                ORDER BY a.duration_ms
              ) FILTER (WHERE a.status_code IS NOT NULL) AS p95
         FROM buckets b
         LEFT JOIN delivery_attempts a
                ON a.tenant_id = $1::uuid
               AND a.started_at >= b.bucket_start
               AND a.started_at < b.bucket_start + make_interval(secs => $4::double precision)
               AND ($5::uuid IS NULL OR a.endpoint_id = $5::uuid)
        GROUP BY b.bucket_start
        ORDER BY b.bucket_start`,
      [query.tenantId, query.from, query.to, query.bucketSeconds, query.endpointId ?? null],
    );
    return result.rows.map((row) => ({
      bucketStart: row.bucket_start,
      attempts: Number(row.attempts),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      p95Ms: round(row.p95),
    }));
  }
}

function toTotals(
  row:
    { attempts: string; succeeded: string; rejected: string; transport_errors: string } | undefined,
): AttemptTotals {
  const totals = {
    attempts: Number(row?.attempts ?? 0),
    succeeded: Number(row?.succeeded ?? 0),
    rejected: Number(row?.rejected ?? 0),
    transportErrors: Number(row?.transport_errors ?? 0),
  };
  return { ...totals, errorRate: errorRateOf(totals) };
}

function round(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(Number(value));
}
