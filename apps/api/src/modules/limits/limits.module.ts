import { Global, Module } from '@nestjs/common';
import { RateLimiter } from './domain/rate-limiter';
import { PostgresTokenBucket } from './infrastructure/postgres-token-bucket';
import { IngestRateLimitGuard } from './api/ingest-rate-limit.guard';

@Global()
@Module({
  providers: [{ provide: RateLimiter, useClass: PostgresTokenBucket }, IngestRateLimitGuard],
  exports: [RateLimiter, IngestRateLimitGuard],
})
export class LimitsModule {}
