import { Queryable } from '../../../shared/database/database.service';
import { Delivery, DeliveryState } from './delivery';
import { DeliveryAttempt, DeliveryListItem } from './delivery-attempt';

export interface EnqueueDeliveryInput {
  readonly tenantId: string;
  readonly eventId: string;
  readonly endpointId: string;
  readonly maxAttempts: number;
  readonly partitionKey: string | null;
  readonly nextAttemptAt: Date;
  readonly replayOf?: string | null;
}

export interface DeliveryQuery {
  readonly tenantId: string;
  readonly endpointId?: string;
  readonly states?: readonly DeliveryState[];
  readonly eventType?: string;
  readonly limit: number;
  /** Keyset cursor: only deliveries created strictly before this moment are returned. */
  readonly before?: Date;
}

export interface ReplayFilter {
  readonly tenantId: string;
  readonly endpointId: string;
  readonly states: readonly DeliveryState[];
  /** Guard against an operator replaying an unbounded history by accident. */
  readonly limit: number;
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

  /** Delivery history for the console, filtered and keyset-paginated. */
  abstract search(query: DeliveryQuery, client?: Queryable): Promise<DeliveryListItem[]>;
  abstract findListItem(
    tenantId: string,
    id: string,
    client?: Queryable,
  ): Promise<DeliveryListItem | null>;
  abstract listAttempts(
    tenantId: string,
    deliveryId: string,
    client?: Queryable,
  ): Promise<DeliveryAttempt[]>;

  /** Withdraws a delivery that has not been claimed. Returns false if it already moved on. */
  abstract cancelPending(
    tenantId: string,
    id: string,
    at: Date,
    client?: Queryable,
  ): Promise<boolean>;

  /** Ids of deliveries matching a bulk replay filter, oldest first to preserve event order. */
  abstract findReplayCandidates(filter: ReplayFilter, client?: Queryable): Promise<Delivery[]>;
}
