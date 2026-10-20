import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { HealthModule } from './shared/health/health.module';
import { TenantsModule } from './modules/tenants/tenants.module';

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, TenantsModule],
})
export class AppModule {}
