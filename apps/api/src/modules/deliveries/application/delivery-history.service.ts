import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/clock/clock';
import { ConflictError, NotFoundError } from '../../../shared/errors/domain-error';
import { DeliveryAttempt, DeliveryListItem } from '../domain/delivery-attempt';
import { DeliveryQuery, DeliveryRepository } from '../domain/repositories';

export interface DeliveryDetail {
  readonly delivery: DeliveryListItem;
  readonly attempts: readonly DeliveryAttempt[];
}

@Injectable()
export class DeliveryHistory {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly clock: Clock,
  ) {}

  search(query: DeliveryQuery): Promise<DeliveryListItem[]> {
    return this.deliveries.search(query);
  }

  async detail(tenantId: string, deliveryId: string): Promise<DeliveryDetail> {
    const delivery = await this.deliveries.findListItem(tenantId, deliveryId);
    if (!delivery) throw new NotFoundError('Delivery', deliveryId);
    return {
      delivery,
      attempts: await this.deliveries.listAttempts(tenantId, deliveryId),
    };
  }

  /**
   * Cancels a delivery that has not been claimed yet. A delivery already in flight is not
   * cancellable: the request may well have arrived, and pretending otherwise would make the
   * history lie about what the destination received.
   */
  async cancel(tenantId: string, deliveryId: string): Promise<DeliveryListItem> {
    const existing = await this.deliveries.findListItem(tenantId, deliveryId);
    if (!existing) throw new NotFoundError('Delivery', deliveryId);

    const canceled = await this.deliveries.cancelPending(tenantId, deliveryId, this.clock.now());
    if (!canceled)
      throw new ConflictError(
        `Only a pending delivery can be canceled; this one is ${existing.state}.`,
        'delivery_not_cancelable',
        { state: existing.state },
      );

    return (await this.deliveries.findListItem(tenantId, deliveryId)) ?? existing;
  }
}
