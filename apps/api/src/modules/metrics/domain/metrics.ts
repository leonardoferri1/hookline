export interface MetricsWindow {
  readonly from: Date;
  readonly to: Date;
  readonly bucketSeconds: number;
}

export interface AttemptTotals {
  readonly attempts: number;
  readonly succeeded: number;
  readonly rejected: number;
  readonly transportErrors: number;
  /** Share of attempts that did not end in a 2xx, between 0 and 1. */
  readonly errorRate: number;
}

export interface LatencySummary {
  /**
   * Percentiles over attempts the destination actually answered. Timeouts and refused connections
   * are counted as errors instead: folding a ten-second timeout into the latency distribution
   * would describe how long Hookline waited, not how fast the destination is.
   */
  readonly answeredAttempts: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
  readonly maxMs: number | null;
}

export interface QueueDepth {
  readonly pending: number;
  /** Pending and already due: the part of the backlog the dispatcher can act on right now. */
  readonly dueNow: number;
  readonly inFlight: number;
  readonly failed: number;
}

export interface EndpointMetrics {
  readonly endpointId: string;
  readonly name: string;
  readonly circuitState: string;
  readonly status: string;
  readonly totals: AttemptTotals;
  readonly p95Ms: number | null;
  readonly lastSuccessAt: Date | null;
  readonly lastFailureAt: Date | null;
  readonly consecutiveFailures: number;
}

export interface TimelineBucket {
  readonly bucketStart: Date;
  readonly attempts: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly p95Ms: number | null;
}

export interface DeliveryMetrics {
  readonly window: MetricsWindow;
  readonly totals: AttemptTotals;
  readonly latency: LatencySummary;
  readonly queue: QueueDepth;
  readonly endpoints: readonly EndpointMetrics[];
  readonly timeline: readonly TimelineBucket[];
}

/** Target number of points on the timeline, which fixes the bucket size for a given window. */
export const TIMELINE_POINTS = 60;
export const MIN_BUCKET_SECONDS = 15;
export const MAX_BUCKET_SECONDS = 3600;

export function bucketSecondsFor(windowMinutes: number): number {
  const raw = Math.ceil((windowMinutes * 60) / TIMELINE_POINTS);
  return Math.min(MAX_BUCKET_SECONDS, Math.max(MIN_BUCKET_SECONDS, raw));
}

export function errorRateOf(totals: Omit<AttemptTotals, 'errorRate'>): number {
  if (totals.attempts === 0) return 0;
  return (totals.rejected + totals.transportErrors) / totals.attempts;
}
