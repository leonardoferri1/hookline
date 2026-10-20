import { Queryable } from '../../../shared/database/database.service';
import { RecordedAttempt } from './attempt';

/** A claimed unit of work, joined with everything needed to build and sign the request. */
export interface ClaimedDelivery {
  readonly deliveryId: string;
  readonly tenantId: string;
  readonly endpointId: string;
  readonly endpointUrl: string;
  readonly endpointName: string;
  readonly timeoutMs: number;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly partitionKey: string | null;
  readonly eventId: string;
  readonly eventType: string;
  readonly eventPayload: unknown;
  readonly occurredAt: Date;
  readonly signingSecrets: readonly string[];
}

export interface CompleteDeliveryInput {
  readonly deliveryId: string;
  readonly attempt: RecordedAttempt;
  readonly attemptNumber: number;
  readonly startedAt: Date;
  readonly requestHeaders: Record<string, string>;
  /** Null when the delivery is finished; otherwise when the next attempt becomes due. */
  readonly nextAttemptAt: Date | null;
}

export abstract class DeliveryQueue {
  /**
   * Atomically claims up to `batchSize` due deliveries and leases them to `workerId`.
   * Implementations must let several dispatchers run against the same queue without overlap.
   */
  abstract claimDue(
    workerId: string,
    batchSize: number,
    now: Date,
    leaseSeconds: number,
  ): Promise<ClaimedDelivery[]>;

  /** Records the attempt and moves the delivery to its next state in one transaction. */
  abstract complete(input: CompleteDeliveryInput): Promise<void>;

  /**
   * Returns deliveries whose lease expired to the queue. A dispatcher that was killed mid-request
   * leaves work leased; without recovery it would sit in `in_flight` forever.
   */
  abstract recoverExpiredLeases(now: Date, client?: Queryable): Promise<number>;

  /** Pending deliveries that are due now, per tenant; used by the console to show a backlog. */
  abstract countPending(tenantId: string, now: Date): Promise<number>;
}
