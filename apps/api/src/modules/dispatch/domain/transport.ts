export interface DeliveryRequest {
  readonly url: string;
  /** Exact bytes to send; the signature in `headers` covers this string verbatim. */
  readonly body: string;
  readonly headers: Record<string, string>;
  readonly timeoutMs: number;
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
  /**
   * Stable classification: `timeout`, `dns`, `connection_refused`, `connection_reset`, `tls`,
   * `unreachable`, `blocked` or `unknown`.
   */
  readonly reason: string;
  readonly message: string;
}

export type TransportOutcome = TransportResponse | TransportFailure;

/**
 * Port for sending one request. The transport reports what happened and never decides whether it
 * counts as a success: that judgement, and the retry it implies, belongs to the dispatcher.
 * Signing belongs there too, so the dispatcher can store exactly the headers it asked for.
 */
export abstract class WebhookTransport {
  abstract send(request: DeliveryRequest): Promise<TransportOutcome>;
}
