export interface DeliveryRequest {
  readonly url: string;
  /** Exact bytes to send and to sign; the signature covers this string verbatim. */
  readonly body: string;
  readonly signingSecrets: readonly string[];
  readonly timeoutMs: number;
  readonly deliveryId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly attempt: number;
  readonly requestId: string;
}

export interface TransportResponse {
  readonly kind: 'response';
  readonly statusCode: number;
  readonly durationMs: number;
  readonly responseHeaders: Record<string, string>;
  readonly responseBody: string;
  readonly bodyTruncated: boolean;
}

export interface TransportFailure {
  readonly kind: 'transport_error';
  readonly durationMs: number;
  /** Stable classification: `timeout`, `dns`, `connection_refused`, `tls`, `blocked`, `unknown`. */
  readonly reason: string;
  readonly message: string;
}

export type TransportOutcome = TransportResponse | TransportFailure;

/**
 * Port for sending one signed request. The transport reports what happened and never decides
 * whether it counts as a success - that judgement, and the retry it implies, belongs to the
 * dispatcher.
 */
export abstract class WebhookTransport {
  abstract send(request: DeliveryRequest): Promise<TransportOutcome>;
}
