export interface StreamEventBase {
  readonly tenantId: string;
  /** ISO timestamp, assigned by the publisher. */
  readonly at: string;
}

export interface EventPublished extends StreamEventBase {
  readonly kind: 'event.published';
  readonly eventId: string;
  readonly eventType: string;
  readonly deliveries: number;
}

export interface DeliveryAttempted extends StreamEventBase {
  readonly kind: 'delivery.attempted';
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly eventType: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly outcome: 'succeeded' | 'rejected' | 'transport_error';
  readonly statusCode: number | null;
  readonly durationMs: number;
  readonly nextAttemptAt: string | null;
  readonly exhausted: boolean;
}

export interface CircuitChanged extends StreamEventBase {
  readonly kind: 'endpoint.circuit_changed';
  readonly endpointId: string;
  readonly endpointName: string;
  readonly from: string;
  readonly to: string;
  readonly consecutiveFailures: number;
  readonly retryAt: string | null;
}

export type StreamEvent = EventPublished | DeliveryAttempted | CircuitChanged;

/**
 * Notification payloads are capped at 8000 bytes by PostgreSQL, which is ample for the
 * identifiers and outcomes above. Payload bodies deliberately stay out of the stream: a client
 * that wants one reads the delivery it was told about.
 */
export const STREAM_CHANNEL = 'hookline_stream';
