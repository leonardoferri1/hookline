import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../shared/database/database.service';
import { Delivery } from '../domain/delivery';
import { DeliveryAttempt, DeliveryListItem } from '../domain/delivery-attempt';
import {
  DeliveryQuery,
  DeliveryRepository,
  EnqueueDeliveryInput,
  ReplayFilter,
} from '../domain/repositories';
import {
  DELIVERY_COLUMNS,
  DeliveryAttemptRow,
  DeliveryListRow,
  DeliveryRow,
  toDelivery,
  toDeliveryAttempt,
  toDeliveryListItem,
} from './delivery-row';

/**
 * The console's list view needs the endpoint name and the event type, which live in other tables,
 * plus the end-to-end time a settled delivery took. Computing the latter in SQL keeps every
 * caller from re-deriving it, and `d.*` is expanded explicitly so a schema change surfaces here
 * rather than as an undefined field in the UI.
 */
const LIST_SELECT = `SELECT ${DELIVERY_COLUMNS.split(',')
  .map((column) => `d.${column.trim()}`)
  .join(', ')},
         e.name AS endpoint_name,
         ev.type AS event_type,
         CASE
           WHEN d.completed_at IS NULL THEN NULL
           ELSE extract(epoch FROM (d.completed_at - d.created_at)) * 1000
         END AS settled_in_ms
    FROM deliveries d
    JOIN endpoints e ON e.id = d.endpoint_id
    JOIN events ev ON ev.id = d.event_id`;

@Injectable()
export class PostgresDeliveryRepository extends DeliveryRepository {
  constructor(private readonly database: Database) {
    super();
  }

  /**
   * Inserts the whole fan-out in one statement by unnesting parallel arrays. One round trip keeps
   * the ingest transaction short, which matters because it is the path a publisher waits on.
   */
  override async enqueueMany(
    inputs: readonly EnqueueDeliveryInput[],
    client?: Queryable,
  ): Promise<Delivery[]> {
    if (inputs.length === 0) return [];
    const result = await this.database.with(client).query<DeliveryRow>(
      `INSERT INTO deliveries
         (tenant_id, event_id, endpoint_id, max_attempts, partition_key, next_attempt_at, replay_of)
       SELECT * FROM unnest(
         $1::uuid[], $2::uuid[], $3::uuid[], $4::integer[], $5::text[], $6::timestamptz[], $7::uuid[]
       )
       RETURNING ${DELIVERY_COLUMNS}`,
      [
        inputs.map((input) => input.tenantId),
        inputs.map((input) => input.eventId),
        inputs.map((input) => input.endpointId),
        inputs.map((input) => input.maxAttempts),
        inputs.map((input) => input.partitionKey),
        inputs.map((input) => input.nextAttemptAt),
        inputs.map((input) => input.replayOf ?? null),
      ],
    );
    return result.rows.map(toDelivery);
  }

  override async findById(
    tenantId: string,
    id: string,
    client?: Queryable,
  ): Promise<Delivery | null> {
    const result = await this.database
      .with(client)
      .query<DeliveryRow>(
        `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
    const row = result.rows[0];
    return row ? toDelivery(row) : null;
  }

  override async listByEvent(
    tenantId: string,
    eventId: string,
    client?: Queryable,
  ): Promise<Delivery[]> {
    const result = await this.database.with(client).query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries
          WHERE tenant_id = $1 AND event_id = $2 ORDER BY created_at`,
      [tenantId, eventId],
    );
    return result.rows.map(toDelivery);
  }

  /**
   * Filtered history, newest first, paginated by `created_at` rather than OFFSET: an operator
   * paging through an actively growing table would otherwise see rows shift between pages.
   */
  override async search(query: DeliveryQuery, client?: Queryable): Promise<DeliveryListItem[]> {
    const result = await this.database.with(client).query<DeliveryListRow>(
      `${LIST_SELECT}
       WHERE d.tenant_id = $1::uuid
         AND ($2::uuid IS NULL OR d.endpoint_id = $2::uuid)
         AND ($3::delivery_state[] IS NULL OR d.state = ANY ($3::delivery_state[]))
         AND ($4::text IS NULL OR ev.type = $4::text)
         AND ($5::timestamptz IS NULL OR d.created_at < $5::timestamptz)
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT $6::integer`,
      [
        query.tenantId,
        query.endpointId ?? null,
        query.states && query.states.length > 0 ? [...query.states] : null,
        query.eventType ?? null,
        query.before ?? null,
        query.limit,
      ],
    );
    return result.rows.map(toDeliveryListItem);
  }

  override async findListItem(
    tenantId: string,
    id: string,
    client?: Queryable,
  ): Promise<DeliveryListItem | null> {
    const result = await this.database
      .with(client)
      .query<DeliveryListRow>(`${LIST_SELECT} WHERE d.tenant_id = $1::uuid AND d.id = $2::uuid`, [
        tenantId,
        id,
      ]);
    const row = result.rows[0];
    return row ? toDeliveryListItem(row) : null;
  }

  /** Joined through `deliveries` so one tenant can never read another tenant's attempt log. */
  override async listAttempts(
    tenantId: string,
    deliveryId: string,
    client?: Queryable,
  ): Promise<DeliveryAttempt[]> {
    const result = await this.database.with(client).query<DeliveryAttemptRow>(
      `SELECT a.id, a.delivery_id, a.attempt_number, a.outcome, a.status_code, a.error_reason,
              a.error_message, a.duration_ms, a.request_headers, a.response_headers,
              a.response_body, a.response_truncated, a.started_at
         FROM delivery_attempts a
         JOIN deliveries d ON d.id = a.delivery_id
        WHERE d.tenant_id = $1::uuid AND a.delivery_id = $2::uuid
        ORDER BY a.attempt_number`,
      [tenantId, deliveryId],
    );
    return result.rows.map(toDeliveryAttempt);
  }

  /**
   * Only a delivery that has not been claimed can be withdrawn. The state predicate is part of the
   * UPDATE, so a cancellation that races a dispatcher claim loses cleanly instead of cancelling a
   * request already on the wire.
   */
  override async cancelPending(
    tenantId: string,
    id: string,
    at: Date,
    client?: Queryable,
  ): Promise<boolean> {
    const result = await this.database.with(client).query(
      `UPDATE deliveries
          SET state = 'canceled',
              completed_at = $3::timestamptz,
              leased_by = NULL,
              leased_until = NULL,
              updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid AND state = 'pending'`,
      [tenantId, id, at],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Oldest first, so a bulk replay re-queues a backlog in the order the events were published. */
  override async findReplayCandidates(
    filter: ReplayFilter,
    client?: Queryable,
  ): Promise<Delivery[]> {
    const result = await this.database.with(client).query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS}
         FROM deliveries
        WHERE tenant_id = $1::uuid
          AND endpoint_id = $2::uuid
          AND state = ANY ($3::delivery_state[])
        ORDER BY created_at
        LIMIT $4::integer`,
      [filter.tenantId, filter.endpointId, [...filter.states], filter.limit],
    );
    return result.rows.map(toDelivery);
  }
}
