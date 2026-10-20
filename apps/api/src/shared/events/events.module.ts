import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus';
import { PostgresEventBus } from './postgres-event-bus';

@Global()
@Module({
  providers: [{ provide: EventBus, useClass: PostgresEventBus }],
  exports: [EventBus],
})
export class EventsBusModule {}
