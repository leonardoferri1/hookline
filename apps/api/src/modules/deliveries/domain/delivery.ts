export type DeliveryState = 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'canceled';

export interface Delivery {
  readonly id: string;
  readonly tenantId: string;
  readonly eventId: string;
  readonly endpointId: string;
  readonly state: DeliveryState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly partitionKey: string | null;
  readonly nextAttemptAt: Date;
  readonly leasedUntil: Date | null;
  readonly leasedBy: string | null;
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly firstAttemptAt: Date | null;
  readonly completedAt: Date | null;
  readonly replayOf: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const TERMINAL_STATES: readonly DeliveryState[] = ['succeeded', 'failed', 'canceled'];

export function isTerminal(state: DeliveryState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Attempts left before the retry budget is spent. */
export function remainingAttempts(delivery: Delivery): number {
  return Math.max(0, delivery.maxAttempts - delivery.attemptCount);
}
