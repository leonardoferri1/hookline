/**
 * Shapes the console reads from the API. They mirror the API's response views; keeping them as a
 * hand-written contract rather than generating them makes an accidental API change show up as a
 * TypeScript error in the page that depends on it.
 */

export interface CurrentPrincipal {
  slug: string;
  name: string;
  apiKeyName: string;
  scopes: string[];
  limits: { ingestRatePerMinute: number; ingestBurst: number; maxEndpoints: number };
}

export type CircuitState = 'closed' | 'open' | 'half_open';
export type EndpointStatus = 'enabled' | 'paused';

export interface EndpointHealth {
  circuitState: CircuitState;
  consecutiveFailures: number;
  circuitOpenedAt: string | null;
  circuitRetryAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface Endpoint {
  id: string;
  name: string;
  url: string;
  description: string | null;
  status: EndpointStatus;
  eventTypes: string[];
  maxAttempts: number;
  timeoutMs: number;
  ordered: boolean;
  health: EndpointHealth;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedEndpoint {
  endpoint: Endpoint;
  secret: string;
}

export interface EndpointSecret {
  id: string;
  hint: string;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
}

export type DeliveryState = 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'canceled';

export interface Delivery {
  id: string;
  state: DeliveryState;
  endpointId: string;
  endpointName: string;
  eventId: string;
  eventType: string;
  partitionKey: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  completedAt: string | null;
  settledInMs: number | null;
  replayOf: string | null;
  createdAt: string;
}

export interface DeliveryAttempt {
  attemptNumber: number;
  outcome: 'succeeded' | 'rejected' | 'transport_error';
  statusCode: number | null;
  errorReason: string | null;
  errorMessage: string | null;
  durationMs: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  responseTruncated: boolean;
  startedAt: string;
}

export interface DeliveryDetail {
  delivery: Delivery;
  attempts: DeliveryAttempt[];
}

export interface PublishedEvent {
  event: {
    id: string;
    type: string;
    payload: unknown;
    partitionKey: string | null;
    idempotencyKey: string | null;
    source: string | null;
    occurredAt: string;
    createdAt: string;
  };
  deliveries: Array<{
    id: string;
    endpointId: string;
    state: DeliveryState;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: string;
  }>;
  replayed: boolean;
}

export interface AttemptTotals {
  attempts: number;
  succeeded: number;
  rejected: number;
  transportErrors: number;
  errorRate: number;
}

export interface Metrics {
  window: { from: string; to: string; bucketSeconds: number };
  totals: AttemptTotals;
  latency: {
    answeredAttempts: number;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
  };
  queue: { pending: number; dueNow: number; inFlight: number; failed: number };
  endpoints: Array<{
    endpointId: string;
    name: string;
    status: EndpointStatus;
    circuitState: CircuitState;
    consecutiveFailures: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    totals: AttemptTotals;
    p95Ms: number | null;
  }>;
  timeline: Array<{
    bucketStart: string;
    attempts: number;
    succeeded: number;
    failed: number;
    p95Ms: number | null;
  }>;
}

export interface ReceiverBehaviour {
  mode: 'ok' | 'error' | 'offline';
  latencyMs: number;
  failureRate: number;
  statusCode: number;
  retryAfterSeconds: number | null;
  verifySignature: boolean;
}

export interface ReceiverRequest {
  sequence: number;
  receivedAt: string;
  path: string;
  eventId: string | null;
  eventType: string | null;
  deliveryId: string | null;
  attempt: number | null;
  signature: 'valid' | 'invalid' | 'unchecked';
  signatureReason: string | null;
  statusReturned: number;
  handledInMs: number;
  bodyPreview: string;
}

export interface ReceiverState {
  behaviour: ReceiverBehaviour;
  listening: boolean;
  url: string;
  secretsConfigured: number;
  totalRequests: number;
  requests: ReceiverRequest[];
}

export type StreamEvent =
  | {
      kind: 'event.published';
      tenantId: string;
      at: string;
      eventId: string;
      eventType: string;
      deliveries: number;
    }
  | {
      kind: 'delivery.attempted';
      tenantId: string;
      at: string;
      deliveryId: string;
      endpointId: string;
      eventType: string;
      attempt: number;
      maxAttempts: number;
      outcome: 'succeeded' | 'rejected' | 'transport_error';
      statusCode: number | null;
      durationMs: number;
      nextAttemptAt: string | null;
      exhausted: boolean;
    }
  | {
      kind: 'endpoint.circuit_changed';
      tenantId: string;
      at: string;
      endpointId: string;
      endpointName: string;
      from: CircuitState;
      to: CircuitState;
      consecutiveFailures: number;
      retryAt: string | null;
    }
  | { kind: 'heartbeat'; at: string };
