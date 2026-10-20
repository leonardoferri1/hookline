import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { EndpointCatalog } from './application/endpoint-catalog.service';
import { EndpointHealthRepository } from './domain/endpoint-health.repository';
import { EndpointRepository, EndpointSecretRepository } from './domain/repositories';
import { PostgresEndpointHealthRepository } from './infrastructure/postgres-endpoint-health.repository';
import { PostgresEndpointRepository } from './infrastructure/postgres-endpoint.repository';
import { PostgresEndpointSecretRepository } from './infrastructure/postgres-endpoint-secret.repository';
import { EndpointsController } from './api/endpoints.controller';

@Module({
  imports: [TenantsModule],
  controllers: [EndpointsController],
  providers: [
    { provide: EndpointRepository, useClass: PostgresEndpointRepository },
    { provide: EndpointSecretRepository, useClass: PostgresEndpointSecretRepository },
    { provide: EndpointHealthRepository, useClass: PostgresEndpointHealthRepository },
    EndpointCatalog,
  ],
  exports: [
    EndpointCatalog,
    EndpointRepository,
    EndpointSecretRepository,
    EndpointHealthRepository,
  ],
})
export class EndpointsModule {}
