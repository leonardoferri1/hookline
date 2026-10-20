import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { HealthModule } from './shared/health/health.module';
import { LimitsModule } from './modules/limits/limits.module';
import { TenantsModule } from './modules/tenants/tenants.module';

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, LimitsModule, TenantsModule],
})
export class AppModule {}
