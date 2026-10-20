import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../shared/database/database.service';
import { Delivery } from '../domain/delivery';
import { DeliveryRepository, EnqueueDeliveryInput } from '../domain/repositories';
import { DELIVERY_COLUMNS, DeliveryRow, toDelivery } from './delivery-row';

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
}
