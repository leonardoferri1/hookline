import { Module } from '@nestjs/common';
import { DeliveryRepository } from './domain/repositories';
import { PostgresDeliveryRepository } from './infrastructure/postgres-delivery.repository';

@Module({
  providers: [{ provide: DeliveryRepository, useClass: PostgresDeliveryRepository }],
  exports: [DeliveryRepository],
})
export class DeliveriesModule {}
