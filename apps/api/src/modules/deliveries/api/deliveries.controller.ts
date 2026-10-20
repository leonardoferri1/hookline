import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../../tenants/api/api-key.guard';
import { CurrentPrincipal, RequireScopes } from '../../tenants/api/scopes.decorator';
import { Principal } from '../../tenants/application/principal';
import { DeliveryHistory } from '../application/delivery-history.service';
import { ReplayDelivery } from '../application/replay-delivery.use-case';
import {
  BulkReplayView,
  DeliveryAttemptView,
  DeliveryDetailView,
  DeliveryView,
  ListDeliveriesQuery,
  ReplayEndpointBody,
  ReplayedDeliveryView,
} from './delivery.dto';

@ApiTags('deliveries')
@ApiSecurity('apiKey')
@Controller('deliveries')
@UseGuards(ApiKeyGuard)
export class DeliveriesController {
  constructor(
    private readonly history: DeliveryHistory,
    private readonly replay: ReplayDelivery,
  ) {}

  @Get()
  @RequireScopes('deliveries:read')
  @ApiOperation({
    summary: 'List deliveries, newest first.',
    description:
      'Paginate with `before`, taking the `createdAt` of the last row, so rows do not shift while the table grows.',
  })
  @ApiOkResponse({ type: DeliveryView, isArray: true })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListDeliveriesQuery,
  ): Promise<DeliveryView[]> {
    const deliveries = await this.history.search({
      tenantId: principal.tenant.id,
      endpointId: query.endpointId,
      states: query.state,
      eventType: query.eventType,
      limit: query.limit ?? 50,
      before: query.before ? new Date(query.before) : undefined,
    });
    return deliveries.map(DeliveryView.from);
  }

  @Get(':deliveryId')
  @RequireScopes('deliveries:read')
  @ApiOperation({
    summary: 'Describe one delivery and every attempt made for it.',
    description:
      'Each attempt carries the signature header as sent and the response as received, truncated to the configured cap.',
  })
  @ApiOkResponse({ type: DeliveryDetailView })
  async detail(
    @CurrentPrincipal() principal: Principal,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ): Promise<DeliveryDetailView> {
    const { delivery, attempts } = await this.history.detail(principal.tenant.id, deliveryId);
    return {
      delivery: DeliveryView.from(delivery),
      attempts: attempts.map(DeliveryAttemptView.from),
    };
  }

  @Post(':deliveryId/replay')
  @RequireScopes('deliveries:replay')
  @ApiOperation({
    summary: 'Queue a settled delivery again.',
    description:
      'Creates a new delivery that points at the original, so the record of what already happened is preserved.',
  })
  @ApiCreatedResponse({ type: ReplayedDeliveryView })
  async replayOne(
    @CurrentPrincipal() principal: Principal,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ): Promise<ReplayedDeliveryView> {
    const replayed = await this.replay.replayOne(principal.tenant.id, deliveryId);
    return ReplayedDeliveryView.from(replayed);
  }

  @Post(':deliveryId/cancel')
  @RequireScopes('deliveries:replay')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Withdraw a delivery that has not been attempted yet.',
    description: 'A delivery already in flight cannot be withdrawn: it may have arrived.',
  })
  @ApiOkResponse({ type: DeliveryView })
  async cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ): Promise<DeliveryView> {
    return DeliveryView.from(await this.history.cancel(principal.tenant.id, deliveryId));
  }

  @Post('replay')
  @RequireScopes('deliveries:replay')
  @ApiOperation({
    summary: 'Queue every settled delivery of an endpoint again, oldest first.',
    description:
      'The move to make once a destination is back: re-sends the backlog in publication order.',
  })
  @ApiCreatedResponse({ type: BulkReplayView })
  async replayEndpoint(
    @CurrentPrincipal() principal: Principal,
    @Body() body: ReplayEndpointBody,
  ): Promise<BulkReplayView> {
    const result = await this.replay.replayEndpoint({
      tenantId: principal.tenant.id,
      endpointId: body.endpointId,
      states: body.states,
      limit: body.limit,
    });
    return {
      requeued: result.requeued.map(ReplayedDeliveryView.from),
      skipped: result.skipped,
    };
  }
}
