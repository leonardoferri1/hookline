import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { DeliveryMetricsService } from './application/metrics.service';
import { MetricsRepository } from './domain/metrics.repository';
import { PostgresMetricsRepository } from './infrastructure/postgres-metrics.repository';
import { MetricsController } from './api/metrics.controller';

@Module({
  imports: [TenantsModule],
  controllers: [MetricsController],
  providers: [
    { provide: MetricsRepository, useClass: PostgresMetricsRepository },
    DeliveryMetricsService,
  ],
  exports: [DeliveryMetricsService],
})
export class MetricsModule {}
