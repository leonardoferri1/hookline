import { Module } from '@nestjs/common';
import { AuthenticateApiKey } from './application/authenticate-api-key.use-case';
import { ProvisionTenant } from './application/provision-tenant.use-case';
import { ApiKeyRepository, TenantRepository } from './domain/repositories';
import { PostgresApiKeyRepository } from './infrastructure/postgres-api-key.repository';
import { PostgresTenantRepository } from './infrastructure/postgres-tenant.repository';
import { ApiKeyGuard } from './api/api-key.guard';
import { TenantsController } from './api/tenants.controller';

@Module({
  controllers: [TenantsController],
  providers: [
    { provide: TenantRepository, useClass: PostgresTenantRepository },
    { provide: ApiKeyRepository, useClass: PostgresApiKeyRepository },
    AuthenticateApiKey,
    ProvisionTenant,
    ApiKeyGuard,
  ],
  exports: [ApiKeyGuard, AuthenticateApiKey, ProvisionTenant, TenantRepository, ApiKeyRepository],
})
export class TenantsModule {}
