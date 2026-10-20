import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiKeyGuard } from '../../tenants/api/api-key.guard';
import { CurrentPrincipal, RequireScopes } from '../../tenants/api/scopes.decorator';
import { Principal } from '../../tenants/application/principal';
import { DeliveryMetricsService, MAX_WINDOW_MINUTES } from '../application/metrics.service';
import { DeliveryMetrics } from '../domain/metrics';

export class MetricsQueryParams {
  @ApiPropertyOptional({
    example: 60,
    minimum: 1,
    maximum: MAX_WINDOW_MINUTES,
    description: 'Size of the trailing window, in minutes.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WINDOW_MINUTES)
  windowMinutes?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict every aggregate to one endpoint.' })
  @IsOptional()
  @IsUUID()
  endpointId?: string;
}

class MetricsWindowView {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() bucketSeconds!: number;
}

export class MetricsView {
  @ApiProperty({ type: MetricsWindowView }) window!: MetricsWindowView;
  @ApiProperty({ type: Object }) totals!: unknown;
  @ApiProperty({ type: Object }) latency!: unknown;
  @ApiProperty({ type: Object }) queue!: unknown;
  @ApiProperty({ type: Object, isArray: true }) endpoints!: unknown[];
  @ApiProperty({ type: Object, isArray: true }) timeline!: unknown[];

  static from(metrics: DeliveryMetrics): MetricsView {
    return {
      window: {
        from: metrics.window.from.toISOString(),
        to: metrics.window.to.toISOString(),
        bucketSeconds: metrics.window.bucketSeconds,
      },
      totals: metrics.totals,
      latency: metrics.latency,
      queue: metrics.queue,
      endpoints: metrics.endpoints.map((endpoint) => ({
        ...endpoint,
        lastSuccessAt: endpoint.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: endpoint.lastFailureAt?.toISOString() ?? null,
      })),
      timeline: metrics.timeline.map((bucket) => ({
        ...bucket,
        bucketStart: bucket.bucketStart.toISOString(),
      })),
    };
  }
}

@ApiTags('metrics')
@ApiSecurity('apiKey')
@Controller('metrics')
@UseGuards(ApiKeyGuard)
export class MetricsController {
  constructor(private readonly metrics: DeliveryMetricsService) {}

  @Get()
  @RequireScopes('deliveries:read')
  @ApiOperation({
    summary: 'Delivery volume, error rate, latency percentiles and queue depth.',
    description:
      'Latency percentiles cover attempts the destination answered; timeouts and refused connections are reported as errors instead.',
  })
  @ApiOkResponse({ type: MetricsView })
  async overview(
    @CurrentPrincipal() principal: Principal,
    @Query() query: MetricsQueryParams,
  ): Promise<MetricsView> {
    const metrics = await this.metrics.overview({
      tenantId: principal.tenant.id,
      windowMinutes: query.windowMinutes,
      endpointId: query.endpointId,
    });
    return MetricsView.from(metrics);
  }
}
