import { Module } from '@nestjs/common';
import { EndpointsModule } from '../endpoints/endpoints.module';
import { TenantsModule } from '../tenants/tenants.module';
import { DeliveryHistory } from './application/delivery-history.service';
import { ReplayDelivery } from './application/replay-delivery.use-case';
import { DeliveryRepository } from './domain/repositories';
import { PostgresDeliveryRepository } from './infrastructure/postgres-delivery.repository';
import { DeliveriesController } from './api/deliveries.controller';

@Module({
  imports: [TenantsModule, EndpointsModule],
  controllers: [DeliveriesController],
  providers: [
    { provide: DeliveryRepository, useClass: PostgresDeliveryRepository },
    DeliveryHistory,
    ReplayDelivery,
  ],
  exports: [DeliveryRepository, DeliveryHistory, ReplayDelivery],
})
export class DeliveriesModule {}
