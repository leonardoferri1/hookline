export type AttemptOutcome = 'succeeded' | 'rejected' | 'transport_error';

export interface DeliveryAttempt {
  readonly id: string;
  readonly deliveryId: string;
  readonly attemptNumber: number;
  readonly outcome: AttemptOutcome;
  readonly statusCode: number | null;
  readonly errorReason: string | null;
  readonly errorMessage: string | null;
  readonly durationMs: number;
  readonly requestHeaders: Record<string, string>;
  readonly responseHeaders: Record<string, string>;
  readonly responseBody: string | null;
  readonly responseTruncated: boolean;
  readonly startedAt: Date;
}

/** A delivery joined with the labels an operator needs to recognize it in a list. */
export interface DeliveryListItem {
  readonly id: string;
  readonly state: string;
  readonly endpointId: string;
  readonly endpointName: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly partitionKey: string | null;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly nextAttemptAt: Date;
  readonly firstAttemptAt: Date | null;
  readonly completedAt: Date | null;
  readonly replayOf: string | null;
  readonly createdAt: Date;
  /** Wall-clock time from acceptance to a terminal state, when there is one. */
  readonly settledInMs: number | null;
}
