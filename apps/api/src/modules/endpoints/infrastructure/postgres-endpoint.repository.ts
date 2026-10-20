import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../shared/database/database.service';
import { Endpoint } from '../domain/endpoint';
import {
  CreateEndpointInput,
  EndpointRepository,
  UpdateEndpointInput,
} from '../domain/repositories';
import { ENDPOINT_COLUMNS, EndpointRow, toEndpoint } from './endpoint-row';

@Injectable()
export class PostgresEndpointRepository extends EndpointRepository {
  constructor(private readonly database: Database) {
    super();
  }

  override async findById(
    tenantId: string,
    id: string,
    client?: Queryable,
  ): Promise<Endpoint | null> {
    const result = await this.database
      .with(client)
      .query<EndpointRow>(
        `SELECT ${ENDPOINT_COLUMNS} FROM endpoints WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
    const row = result.rows[0];
    return row ? toEndpoint(row) : null;
  }

  override async listByTenant(tenantId: string, client?: Queryable): Promise<Endpoint[]> {
    const result = await this.database
      .with(client)
      .query<EndpointRow>(
        `SELECT ${ENDPOINT_COLUMNS} FROM endpoints WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
    return result.rows.map(toEndpoint);
  }

  override async countByTenant(tenantId: string, client?: Queryable): Promise<number> {
    const result = await this.database
      .with(client)
      .query<{ total: string }>(`SELECT count(*) AS total FROM endpoints WHERE tenant_id = $1`, [
        tenantId,
      ]);
    return Number(result.rows[0]?.total ?? 0);
  }

  /**
   * Fan-out runs in the database so ingest does not load every endpoint into memory to filter it.
   * The predicate mirrors `matchesSubscription`: an exact match, `*`, or a `prefix.*` pattern
   * turned into a LIKE prefix. Event types exclude `_` precisely so this LIKE cannot widen.
   */
  override async findSubscribers(
    tenantId: string,
    eventType: string,
    client?: Queryable,
  ): Promise<Endpoint[]> {
    const result = await this.database.with(client).query<EndpointRow>(
      `SELECT ${ENDPOINT_COLUMNS}
         FROM endpoints e
        WHERE e.tenant_id = $1
          AND e.status = 'enabled'
          AND EXISTS (
                SELECT 1
                  FROM unnest(e.event_types) AS pattern
                 WHERE pattern = '*'
                    OR pattern = $2
                    OR (right(pattern, 2) = '.*' AND $2 LIKE left(pattern, -1) || '%')
              )
        ORDER BY e.created_at`,
      [tenantId, eventType],
    );
    return result.rows.map(toEndpoint);
  }

  override async create(input: CreateEndpointInput, client?: Queryable): Promise<Endpoint> {
    const result = await this.database.with(client).query<EndpointRow>(
      `INSERT INTO endpoints
         (tenant_id, name, url, description, event_types, max_attempts, timeout_ms, ordered)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${ENDPOINT_COLUMNS}`,
      [
        input.tenantId,
        input.name,
        input.url,
        input.description,
        [...input.eventTypes],
        input.maxAttempts,
        input.timeoutMs,
        input.ordered,
      ],
    );
    return toEndpoint(result.rows[0]!);
  }

  /**
   * Partial update expressed with COALESCE so absent fields keep their stored value. Re-enabling an
   * endpoint also clears the breaker: an operator who turns a destination back on is asserting it
   * is healthy, and the next failure will open it again.
   */
  override async update(
    tenantId: string,
    id: string,
    input: UpdateEndpointInput,
    client?: Queryable,
  ): Promise<Endpoint | null> {
    const result = await this.database.with(client).query<EndpointRow>(
      `UPDATE endpoints
          SET name = COALESCE($3, name),
              url = COALESCE($4, url),
              description = CASE WHEN $5::boolean THEN $6 ELSE description END,
              event_types = COALESCE($7, event_types),
              max_attempts = COALESCE($8, max_attempts),
              timeout_ms = COALESCE($9, timeout_ms),
              ordered = COALESCE($10, ordered),
              status = COALESCE($11, status),
              circuit_state = CASE WHEN $11 = 'enabled' THEN 'closed' ELSE circuit_state END,
              consecutive_failures = CASE WHEN $11 = 'enabled' THEN 0 ELSE consecutive_failures END,
              circuit_opened_at = CASE WHEN $11 = 'enabled' THEN NULL ELSE circuit_opened_at END,
              circuit_retry_at = CASE WHEN $11 = 'enabled' THEN NULL ELSE circuit_retry_at END,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${ENDPOINT_COLUMNS}`,
      [
        tenantId,
        id,
        input.name ?? null,
        input.url ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.eventTypes ? [...input.eventTypes] : null,
        input.maxAttempts ?? null,
        input.timeoutMs ?? null,
        input.ordered ?? null,
        input.status ?? null,
      ],
    );
    const row = result.rows[0];
    return row ? toEndpoint(row) : null;
  }

  override async delete(tenantId: string, id: string, client?: Queryable): Promise<boolean> {
    const result = await this.database
      .with(client)
      .query(`DELETE FROM endpoints WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    return (result.rowCount ?? 0) > 0;
  }
}
