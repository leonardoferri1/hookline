import { Queryable } from '../../../shared/database/database.service';
import { Delivery } from './delivery';

export interface EnqueueDeliveryInput {
  readonly tenantId: string;
  readonly eventId: string;
  readonly endpointId: string;
  readonly maxAttempts: number;
  readonly partitionKey: string | null;
  readonly nextAttemptAt: Date;
  readonly replayOf?: string | null;
}

export abstract class DeliveryRepository {
  /**
   * Queues one delivery per subscribing endpoint. Written through the caller's transaction so the
   * event and its deliveries become visible together: a committed event with no queued work would
   * be silently lost, and queued work for an uncommitted event could never be read.
   */
  abstract enqueueMany(
    inputs: readonly EnqueueDeliveryInput[],
    client?: Queryable,
  ): Promise<Delivery[]>;

  abstract findById(tenantId: string, id: string, client?: Queryable): Promise<Delivery | null>;
  abstract listByEvent(tenantId: string, eventId: string, client?: Queryable): Promise<Delivery[]>;
}
