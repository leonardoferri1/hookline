import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/clock/clock';
import { DeliveryMetrics, bucketSecondsFor } from '../domain/metrics';
import { MetricsRepository } from '../domain/metrics.repository';

export const DEFAULT_WINDOW_MINUTES = 60;
export const MAX_WINDOW_MINUTES = 1440;

export interface MetricsRequest {
  readonly tenantId: string;
  readonly windowMinutes?: number;
  readonly endpointId?: string;
}

@Injectable()
export class DeliveryMetricsService {
  constructor(
    private readonly metrics: MetricsRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Resolves the window once and reuses it for every aggregate, so the totals, the latency
   * summary, the per-endpoint table and the timeline all describe the same interval. Computing
   * `now` per query would let the timeline cover a slightly different span than the totals above
   * it, and the numbers would not add up for a reader comparing them.
   */
  async overview(request: MetricsRequest): Promise<DeliveryMetrics> {
    const to = this.clock.now();
    const windowMinutes = Math.min(
      Math.max(request.windowMinutes ?? DEFAULT_WINDOW_MINUTES, 1),
      MAX_WINDOW_MINUTES,
    );
    const from = new Date(to.getTime() - windowMinutes * 60_000);
    const bucketSeconds = bucketSecondsFor(windowMinutes);
    const query = {
      tenantId: request.tenantId,
      from,
      to,
      bucketSeconds,
      endpointId: request.endpointId,
    };

    const [totals, latency, queue, endpoints, timeline] = await Promise.all([
      this.metrics.totals(query),
      this.metrics.latency(query),
      this.metrics.queueDepth(request.tenantId, to),
      this.metrics.perEndpoint(query),
      this.metrics.timeline(query),
    ]);

    return { window: { from, to, bucketSeconds }, totals, latency, queue, endpoints, timeline };
  }
}
