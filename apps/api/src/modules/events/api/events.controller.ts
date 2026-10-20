import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ValidationError } from '../../../shared/errors/domain-error';
import { IngestRateLimitGuard } from '../../limits/api/ingest-rate-limit.guard';
import { ApiKeyGuard } from '../../tenants/api/api-key.guard';
import { CurrentPrincipal, RequireScopes } from '../../tenants/api/scopes.decorator';
import { Principal } from '../../tenants/application/principal';
import { PublishEvent } from '../application/publish-event.use-case';
import { EventRepository } from '../domain/repositories';
import { EventView, ListEventsQuery, PublishEventBody, PublishedEventView } from './event.dto';

const IDEMPOTENCY_KEY_PATTERN = /^[\w.:-]{8,200}$/;

@ApiTags('events')
@ApiSecurity('apiKey')
@Controller('events')
@UseGuards(ApiKeyGuard)
export class EventsController {
  constructor(
    private readonly publishEvent: PublishEvent,
    private readonly events: EventRepository,
  ) {}

  @Post()
  @RequireScopes('events:write')
  @UseGuards(IngestRateLimitGuard)
  // 202 rather than 201: the response means the event is durable and queued, not delivered.
  @HttpCode(202)
  @ApiOperation({
    summary: 'Publish an event and queue a delivery for every subscribing endpoint.',
    description:
      'Returns once the event and its deliveries are committed. Delivery happens asynchronously; follow it through the deliveries API.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Retrying with the same key returns the original event instead of publishing a second one.',
  })
  @ApiOkResponse({ type: PublishedEventView })
  async publish(
    @CurrentPrincipal() principal: Principal,
    @Body() body: PublishEventBody,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PublishedEventView> {
    if (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))
      throw new ValidationError(
        'Idempotency-Key must be 8 to 200 characters of letters, digits, "-", "_", "." or ":".',
      );

    const result = await this.publishEvent.execute({
      tenantId: principal.tenant.id,
      type: body.type,
      payload: body.payload,
      partitionKey: body.partitionKey ?? null,
      idempotencyKey: idempotencyKey ?? null,
      source: body.source ?? null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : null,
    });
    return PublishedEventView.from(result);
  }

  @Get()
  @RequireScopes('deliveries:read')
  @ApiOperation({ summary: 'List published events, newest first.' })
  @ApiOkResponse({ type: EventView, isArray: true })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListEventsQuery,
  ): Promise<EventView[]> {
    const events = await this.events.list({
      tenantId: principal.tenant.id,
      type: query.type,
      limit: query.limit ?? 50,
      before: query.before ? new Date(query.before) : undefined,
    });
    return events.map(EventView.from);
  }

  @Get(':eventId')
  @RequireScopes('deliveries:read')
  @ApiOperation({ summary: 'Describe one event and the deliveries it produced.' })
  @ApiOkResponse({ type: PublishedEventView })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<PublishedEventView> {
    return PublishedEventView.from(await this.publishEvent.get(principal.tenant.id, eventId));
  }
}
