import { Module } from '@nestjs/common';
import { EndpointsModule } from '../endpoints/endpoints.module';
import { DeliveryDispatcher } from './application/delivery-dispatcher.service';
import { DispatchWorker } from './application/dispatch-worker.service';
import { DeliveryQueue } from './domain/queue.repository';
import { WebhookTransport } from './domain/transport';
import { HttpWebhookTransport } from './infrastructure/http-transport';
import { PostgresDeliveryQueue } from './infrastructure/postgres-delivery-queue.repository';

@Module({
  imports: [EndpointsModule],
  providers: [
    { provide: DeliveryQueue, useClass: PostgresDeliveryQueue },
    { provide: WebhookTransport, useClass: HttpWebhookTransport },
    DeliveryDispatcher,
    DispatchWorker,
  ],
  exports: [DeliveryQueue, DeliveryDispatcher, DispatchWorker],
})
export class DispatchModule {}
