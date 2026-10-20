import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { EventsBusModule } from './shared/events/events.module';
import { HealthModule } from './shared/health/health.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { EndpointsModule } from './modules/endpoints/endpoints.module';
import { EventsModule } from './modules/events/events.module';
import { StreamModule } from './modules/stream/stream.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { LimitsModule } from './modules/limits/limits.module';
import { TenantsModule } from './modules/tenants/tenants.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EventsBusModule,
    HealthModule,
    LimitsModule,
    TenantsModule,
    EndpointsModule,
    DeliveriesModule,
    EventsModule,
    DispatchModule,
    MetricsModule,
    StreamModule,
  ],
})
export class AppModule {}
