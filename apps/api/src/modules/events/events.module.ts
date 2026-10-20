import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { EndpointsModule } from '../endpoints/endpoints.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PublishEvent } from './application/publish-event.use-case';
import { EventRepository } from './domain/repositories';
import { PostgresEventRepository } from './infrastructure/postgres-event.repository';
import { EventsController } from './api/events.controller';

@Module({
  imports: [TenantsModule, EndpointsModule, DeliveriesModule],
  controllers: [EventsController],
  providers: [{ provide: EventRepository, useClass: PostgresEventRepository }, PublishEvent],
  exports: [PublishEvent, EventRepository],
})
export class EventsModule {}
