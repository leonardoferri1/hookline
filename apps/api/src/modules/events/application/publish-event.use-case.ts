import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../shared/clock/clock';
import { Database, Queryable } from '../../../shared/database/database.service';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/domain-error';
import { isEventType } from '../../endpoints/domain/event-type';
import { EndpointRepository } from '../../endpoints/domain/repositories';
import { Delivery } from '../../deliveries/domain/delivery';
import { DeliveryRepository } from '../../deliveries/domain/repositories';
import { HooklineEvent, fingerprintEvent } from '../domain/event';
import { EventRepository } from '../domain/repositories';

export interface PublishEventCommand {
  readonly tenantId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly partitionKey?: string | null;
  readonly idempotencyKey?: string | null;
  readonly source?: string | null;
  readonly occurredAt?: Date | null;
}

export interface PublishEventResult {
  readonly event: HooklineEvent;
  readonly deliveries: readonly Delivery[];
  /** True when the request matched a key that had already been accepted. */
  readonly replayed: boolean;
}

/** An `occurred_at` further in the future than this is treated as a client clock problem. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

@Injectable()
export class PublishEvent {
  private readonly logger = new Logger(PublishEvent.name);

  constructor(
    private readonly database: Database,
    private readonly events: EventRepository,
    private readonly endpoints: EndpointRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly clock: Clock,
  ) {}

  async execute(command: PublishEventCommand): Promise<PublishEventResult> {
    if (!isEventType(command.type))
      throw new ValidationError(
        'Event types are lowercase, dot-separated names such as "order.paid".',
        { type: command.type },
      );

    const now = this.clock.now();
    const occurredAt = command.occurredAt ?? now;
    if (occurredAt.getTime() - now.getTime() > MAX_CLOCK_SKEW_MS)
      throw new ValidationError('occurredAt is more than five minutes in the future.', {
        occurredAt: occurredAt.toISOString(),
      });

    const partitionKey = command.partitionKey?.trim() || null;
    const idempotencyKey = command.idempotencyKey?.trim() || null;
    const fingerprint = fingerprintEvent({
      type: command.type,
      payload: command.payload,
      partitionKey,
    });

    const write = (client: Queryable) =>
      this.recordAndFanOut(client, command, {
        partitionKey,
        idempotencyKey,
        fingerprint,
        occurredAt,
        now,
      });

    // Without a key there is nothing to deduplicate, so the write runs in a plain transaction.
    if (!idempotencyKey) return this.database.transaction(write);

    /*
     * With a key, concurrent retries are serialized on the key itself rather than left to the
     * unique index. Catching the violation afterwards is not enough: the loser would re-read
     * before the winner committed and find nothing, under READ COMMITTED. The lock is scoped to
     * one tenant and one key, so unrelated publishes never contend on it.
     */
    return this.database.withAdvisoryLock(
      `event:${command.tenantId}:${idempotencyKey}`,
      async (client) => {
        const existing = await this.events.findByIdempotencyKey(
          command.tenantId,
          idempotencyKey,
          client,
        );
        if (!existing) return write(client);
        if (existing.payloadFingerprint !== fingerprint)
          throw new ConflictError(
            'This idempotency key was already used with a different event body.',
            'idempotency_key_reuse',
            { idempotencyKey },
          );
        return {
          event: existing,
          deliveries: await this.deliveries.listByEvent(command.tenantId, existing.id, client),
          replayed: true,
        };
      },
    );
  }

  /**
   * Records the event and queues one delivery per subscribing endpoint inside a single
   * transaction. This is the outbox boundary: the publisher's acknowledgement means the work is
   * durable, not that it has been sent.
   */
  private async recordAndFanOut(
    client: Queryable,
    command: PublishEventCommand,
    derived: {
      partitionKey: string | null;
      idempotencyKey: string | null;
      fingerprint: string;
      occurredAt: Date;
      now: Date;
    },
  ): Promise<PublishEventResult> {
    const event = await this.events.record(
      {
        tenantId: command.tenantId,
        type: command.type,
        payload: command.payload,
        partitionKey: derived.partitionKey,
        idempotencyKey: derived.idempotencyKey,
        payloadFingerprint: derived.fingerprint,
        source: command.source?.trim() || null,
        occurredAt: derived.occurredAt,
      },
      client,
    );

    const subscribers = await this.endpoints.findSubscribers(
      command.tenantId,
      command.type,
      client,
    );
    const deliveries = await this.deliveries.enqueueMany(
      subscribers.map((endpoint) => ({
        tenantId: command.tenantId,
        eventId: event.id,
        endpointId: endpoint.id,
        maxAttempts: endpoint.maxAttempts,
        partitionKey: derived.partitionKey,
        nextAttemptAt: derived.now,
      })),
      client,
    );

    if (subscribers.length === 0)
      this.logger.warn({
        message: 'event.no_subscribers',
        eventId: event.id,
        eventType: event.type,
      });

    return { event, deliveries, replayed: false };
  }

  async get(tenantId: string, eventId: string): Promise<PublishEventResult> {
    const event = await this.events.findById(tenantId, eventId);
    if (!event) throw new NotFoundError('Event', eventId);
    return {
      event,
      deliveries: await this.deliveries.listByEvent(tenantId, eventId),
      replayed: false,
    };
  }
}
