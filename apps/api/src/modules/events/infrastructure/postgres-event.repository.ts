import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../shared/database/database.service';
import { HooklineEvent } from '../domain/event';
import { EventQuery, EventRepository, RecordEventInput } from '../domain/repositories';

interface EventRow {
  id: string;
  tenant_id: string;
  type: string;
  payload: unknown;
  partition_key: string | null;
  idempotency_key: string | null;
  payload_fingerprint: string;
  source: string | null;
  occurred_at: Date;
  created_at: Date;
}

const COLUMNS = `id, tenant_id, type, payload, partition_key, idempotency_key,
  payload_fingerprint, source, occurred_at, created_at`;

@Injectable()
export class PostgresEventRepository extends EventRepository {
  constructor(private readonly database: Database) {
    super();
  }

  override async record(input: RecordEventInput, client?: Queryable): Promise<HooklineEvent> {
    const result = await this.database.with(client).query<EventRow>(
      `INSERT INTO events
         (tenant_id, type, payload, partition_key, idempotency_key, payload_fingerprint, source, occurred_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [
        input.tenantId,
        input.type,
        JSON.stringify(input.payload),
        input.partitionKey,
        input.idempotencyKey,
        input.payloadFingerprint,
        input.source,
        input.occurredAt,
      ],
    );
    return toEvent(result.rows[0]!);
  }

  override async findById(
    tenantId: string,
    id: string,
    client?: Queryable,
  ): Promise<HooklineEvent | null> {
    const result = await this.database
      .with(client)
      .query<EventRow>(`SELECT ${COLUMNS} FROM events WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        id,
      ]);
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  }

  override async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
    client?: Queryable,
  ): Promise<HooklineEvent | null> {
    const result = await this.database
      .with(client)
      .query<EventRow>(
        `SELECT ${COLUMNS} FROM events WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, idempotencyKey],
      );
    const row = result.rows[0];
    return row ? toEvent(row) : null;
  }

  /** Keyset pagination on `created_at`, which the tenant index already orders. */
  override async list(query: EventQuery, client?: Queryable): Promise<HooklineEvent[]> {
    const result = await this.database.with(client).query<EventRow>(
      `SELECT ${COLUMNS}
         FROM events
        WHERE tenant_id = $1
          AND ($2::text IS NULL OR type = $2)
          AND ($3::timestamptz IS NULL OR created_at < $3)
        ORDER BY created_at DESC
        LIMIT $4`,
      [query.tenantId, query.type ?? null, query.before ?? null, query.limit],
    );
    return result.rows.map(toEvent);
  }
}

function toEvent(row: EventRow): HooklineEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    payload: row.payload,
    partitionKey: row.partition_key,
    idempotencyKey: row.idempotency_key,
    payloadFingerprint: row.payload_fingerprint,
    source: row.source,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}
