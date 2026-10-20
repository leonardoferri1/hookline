import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../shared/clock/clock';
import { Database } from '../../../shared/database/database.service';
import { ConflictError, NotFoundError } from '../../../shared/errors/domain-error';
import { EndpointRepository } from '../../endpoints/domain/repositories';
import { Delivery, DeliveryState, isTerminal } from '../domain/delivery';
import { DeliveryRepository } from '../domain/repositories';

/** Upper bound on one bulk replay, so a stray click cannot re-queue a month of history. */
export const MAX_BULK_REPLAY = 500;

export interface BulkReplayCommand {
  readonly tenantId: string;
  readonly endpointId: string;
  readonly states?: readonly DeliveryState[];
  readonly limit?: number;
}

export interface BulkReplayResult {
  readonly requeued: readonly Delivery[];
  readonly skipped: number;
}

/**
 * Re-queues a delivery as a *new* row that points at the original through `replay_of`.
 *
 * Resetting the original would destroy the record of what already happened, which is the one
 * thing an operator investigating a complaint needs. A replay therefore reads as a separate
 * delivery of the same event, with its own attempts and its own retry budget, and the chain stays
 * auditable.
 */
@Injectable()
export class ReplayDelivery {
  private readonly logger = new Logger(ReplayDelivery.name);

  constructor(
    private readonly database: Database,
    private readonly deliveries: DeliveryRepository,
    private readonly endpoints: EndpointRepository,
    private readonly clock: Clock,
  ) {}

  async replayOne(tenantId: string, deliveryId: string): Promise<Delivery> {
    const original = await this.deliveries.findById(tenantId, deliveryId);
    if (!original) throw new NotFoundError('Delivery', deliveryId);
    if (!isTerminal(original.state))
      throw new ConflictError(
        `This delivery is still ${original.state}; wait for it to settle before replaying.`,
        'delivery_in_progress',
        { state: original.state },
      );

    const endpoint = await this.endpoints.findById(tenantId, original.endpointId);
    if (!endpoint) throw new NotFoundError('Endpoint', original.endpointId);

    const [replay] = await this.deliveries.enqueueMany([
      {
        tenantId,
        eventId: original.eventId,
        endpointId: original.endpointId,
        // The endpoint's current budget, not the original's: a replay is a fresh decision.
        maxAttempts: endpoint.maxAttempts,
        partitionKey: original.partitionKey,
        nextAttemptAt: this.clock.now(),
        replayOf: original.id,
      },
    ]);

    this.logger.log({
      message: 'delivery.replayed',
      deliveryId: replay!.id,
      replayOf: original.id,
      endpoint: endpoint.name,
    });
    return replay!;
  }

  /**
   * Re-queues every settled delivery of an endpoint that matches `states`, oldest first.
   *
   * This is the move an operator makes once a destination is back: the whole failed backlog is
   * re-sent in publication order, in one transaction so a partial requeue cannot be left behind.
   */
  async replayEndpoint(command: BulkReplayCommand): Promise<BulkReplayResult> {
    const states = command.states ?? (['failed'] as const);
    const unsettled = states.filter((state) => !isTerminal(state));
    if (unsettled.length > 0)
      throw new ConflictError('Only settled deliveries can be replayed.', 'delivery_in_progress', {
        states: unsettled,
      });

    const endpoint = await this.endpoints.findById(command.tenantId, command.endpointId);
    if (!endpoint) throw new NotFoundError('Endpoint', command.endpointId);

    const limit = Math.min(command.limit ?? MAX_BULK_REPLAY, MAX_BULK_REPLAY);
    return this.database.transaction(async (client) => {
      const candidates = await this.deliveries.findReplayCandidates(
        { tenantId: command.tenantId, endpointId: command.endpointId, states, limit: limit + 1 },
        client,
      );
      const selected = candidates.slice(0, limit);
      const now = this.clock.now();
      const requeued = await this.deliveries.enqueueMany(
        selected.map((original) => ({
          tenantId: command.tenantId,
          eventId: original.eventId,
          endpointId: original.endpointId,
          maxAttempts: endpoint.maxAttempts,
          partitionKey: original.partitionKey,
          nextAttemptAt: now,
          replayOf: original.id,
        })),
        client,
      );

      this.logger.log({
        message: 'delivery.bulk_replayed',
        endpoint: endpoint.name,
        requeued: requeued.length,
        truncated: candidates.length > limit,
      });

      return { requeued, skipped: Math.max(0, candidates.length - limit) };
    });
  }
}
