import { TransportOutcome } from './transport';

export type AttemptOutcome = 'succeeded' | 'rejected' | 'transport_error';

export interface RecordedAttempt {
  readonly outcome: AttemptOutcome;
  readonly statusCode: number | null;
  readonly errorReason: string | null;
  readonly errorMessage: string | null;
  readonly durationMs: number;
  readonly responseHeaders: Record<string, string>;
  readonly responseBody: string | null;
  readonly responseTruncated: boolean;
}

/**
 * Only 2xx counts as delivered.
 *
 * A 3xx is treated as a failure rather than followed: the destination is asking the sender to go
 * somewhere the address policy has not cleared. A 4xx is also retried, unlike in some providers,
 * because the common causes here - a deploy in progress, an expired secret, a consumer that has
 * not registered the route yet - are transient from the sender's side. The retry budget, not the
 * status class, is what stops a delivery.
 */
export function classifyOutcome(outcome: TransportOutcome): RecordedAttempt {
  if (outcome.kind === 'transport_error')
    return {
      outcome: 'transport_error',
      statusCode: null,
      errorReason: outcome.reason,
      errorMessage: outcome.message,
      durationMs: Math.round(outcome.durationMs),
      responseHeaders: {},
      responseBody: null,
      responseTruncated: false,
    };

  const delivered = outcome.statusCode >= 200 && outcome.statusCode < 300;
  return {
    outcome: delivered ? 'succeeded' : 'rejected',
    statusCode: outcome.statusCode,
    errorReason: delivered ? null : `http_${outcome.statusCode}`,
    errorMessage: delivered ? null : `The destination answered ${outcome.statusCode}.`,
    durationMs: Math.round(outcome.durationMs),
    responseHeaders: outcome.responseHeaders,
    responseBody: outcome.responseBody,
    responseTruncated: outcome.bodyTruncated,
  };
}
