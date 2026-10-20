import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { HealthModule } from './shared/health/health.module';
import { EndpointsModule } from './modules/endpoints/endpoints.module';
import { LimitsModule } from './modules/limits/limits.module';
import { TenantsModule } from './modules/tenants/tenants.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    LimitsModule,
    TenantsModule,
    EndpointsModule,
  ],
})
export class AppModule {}
