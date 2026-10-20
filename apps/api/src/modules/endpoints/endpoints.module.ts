import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { EndpointCatalog } from './application/endpoint-catalog.service';
import { EndpointRepository, EndpointSecretRepository } from './domain/repositories';
import { PostgresEndpointRepository } from './infrastructure/postgres-endpoint.repository';
import { PostgresEndpointSecretRepository } from './infrastructure/postgres-endpoint-secret.repository';
import { EndpointsController } from './api/endpoints.controller';

@Module({
  imports: [TenantsModule],
  controllers: [EndpointsController],
  providers: [
    { provide: EndpointRepository, useClass: PostgresEndpointRepository },
    { provide: EndpointSecretRepository, useClass: PostgresEndpointSecretRepository },
    EndpointCatalog,
  ],
  exports: [EndpointCatalog, EndpointRepository, EndpointSecretRepository],
})
export class EndpointsModule {}
