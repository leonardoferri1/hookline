import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Clock } from '../../../shared/clock/clock';
import { Principal } from '../../tenants/application/principal';
import { ApiKeyGuard } from '../../tenants/api/api-key.guard';
import { CurrentPrincipal, RequireScopes } from '../../tenants/api/scopes.decorator';
import { EndpointCatalog } from '../application/endpoint-catalog.service';
import {
  CreateEndpointBody,
  CreatedEndpointView,
  EndpointSecretView,
  EndpointView,
  RotateSecretBody,
  UpdateEndpointBody,
} from './endpoint.dto';

@ApiTags('endpoints')
@ApiSecurity('apiKey')
@Controller('endpoints')
@UseGuards(ApiKeyGuard)
export class EndpointsController {
  constructor(
    private readonly catalog: EndpointCatalog,
    private readonly clock: Clock,
  ) {}

  @Get()
  @RequireScopes('endpoints:read')
  @ApiOperation({ summary: 'List the destinations configured for this tenant.' })
  @ApiOkResponse({ type: EndpointView, isArray: true })
  async list(@CurrentPrincipal() principal: Principal): Promise<EndpointView[]> {
    const endpoints = await this.catalog.list(principal.tenant.id);
    return endpoints.map(EndpointView.from);
  }

  @Post()
  @RequireScopes('endpoints:write')
  @ApiOperation({
    summary: 'Register a destination and issue its first signing secret.',
    description: 'The secret is returned once; Hookline will not display it again.',
  })
  @ApiCreatedResponse({ type: CreatedEndpointView })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateEndpointBody,
  ): Promise<CreatedEndpointView> {
    const { endpoint, secret } = await this.catalog.create({
      tenantId: principal.tenant.id,
      limits: principal.tenant.limits,
      name: body.name,
      url: body.url,
      description: body.description ?? null,
      eventTypes: body.eventTypes,
      maxAttempts: body.maxAttempts,
      timeoutMs: body.timeoutMs,
      ordered: body.ordered,
    });
    return { endpoint: EndpointView.from(endpoint), secret };
  }

  @Get(':endpointId')
  @RequireScopes('endpoints:read')
  @ApiOperation({ summary: 'Describe one destination, including its delivery health.' })
  @ApiOkResponse({ type: EndpointView })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
  ): Promise<EndpointView> {
    return EndpointView.from(await this.catalog.get(principal.tenant.id, endpointId));
  }

  @Patch(':endpointId')
  @RequireScopes('endpoints:write')
  @ApiOperation({
    summary: 'Update a destination.',
    description: 'Setting the status back to "enabled" also closes an open circuit breaker.',
  })
  @ApiOkResponse({ type: EndpointView })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @Body() body: UpdateEndpointBody,
  ): Promise<EndpointView> {
    const endpoint = await this.catalog.update({
      tenantId: principal.tenant.id,
      endpointId,
      ...body,
    });
    return EndpointView.from(endpoint);
  }

  @Delete(':endpointId')
  @RequireScopes('endpoints:write')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a destination and its delivery history.' })
  @ApiNoContentResponse()
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
  ): Promise<void> {
    await this.catalog.delete(principal.tenant.id, endpointId);
  }

  @Get(':endpointId/secrets')
  @RequireScopes('endpoints:read')
  @ApiOperation({ summary: 'List signing secret metadata, newest first.' })
  @ApiOkResponse({ type: EndpointSecretView, isArray: true })
  async secrets(
    @CurrentPrincipal() principal: Principal,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
  ): Promise<EndpointSecretView[]> {
    const secrets = await this.catalog.listSecrets(principal.tenant.id, endpointId);
    const now = this.clock.now();
    return secrets.map((secret) => EndpointSecretView.from(secret, now));
  }

  @Post(':endpointId/secrets/rotate')
  @RequireScopes('endpoints:write')
  @ApiOperation({
    summary: 'Issue a new signing secret.',
    description:
      'Both secrets sign outgoing requests until the grace window closes, so the consumer can adopt the new one without dropping requests already in flight.',
  })
  @ApiCreatedResponse({ type: CreatedEndpointView })
  async rotate(
    @CurrentPrincipal() principal: Principal,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @Body() body: RotateSecretBody,
  ): Promise<CreatedEndpointView> {
    const { endpoint, secret } = await this.catalog.rotateSecret(
      principal.tenant.id,
      endpointId,
      body.graceSeconds,
    );
    return { endpoint: EndpointView.from(endpoint), secret };
  }
}
