import {
  AttemptTotals,
  EndpointMetrics,
  LatencySummary,
  QueueDepth,
  TimelineBucket,
} from './metrics';

export interface MetricsQuery {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
  readonly bucketSeconds: number;
  readonly endpointId?: string;
}

export abstract class MetricsRepository {
  abstract totals(query: MetricsQuery): Promise<AttemptTotals>;
  abstract latency(query: MetricsQuery): Promise<LatencySummary>;
  abstract queueDepth(tenantId: string, now: Date): Promise<QueueDepth>;
  abstract perEndpoint(query: MetricsQuery): Promise<EndpointMetrics[]>;
  abstract timeline(query: MetricsQuery): Promise<TimelineBucket[]>;
}
