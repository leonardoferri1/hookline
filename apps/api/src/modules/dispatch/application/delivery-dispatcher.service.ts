import { Inject, Injectable, Logger } from '@nestjs/common';
import { SIGNATURE_HEADER, buildSignatureHeader } from '@hookline/signature';
import { APP_CONFIG, AppConfig } from '../../../config/app-config';
import { Clock } from '../../../shared/clock/clock';
import { EndpointHealthRepository } from '../../endpoints/domain/endpoint-health.repository';
import { CircuitState } from '../../endpoints/domain/endpoint';
import { AttemptOutcome, classifyOutcome } from '../domain/attempt';
import { DEFAULT_BREAKER } from '../domain/circuit-breaker';
import { DEFAULT_BACKOFF, nextDelaySeconds, parseRetryAfter } from '../domain/backoff';
import { ClaimedDelivery, DeliveryQueue } from '../domain/queue.repository';
import { TransportOutcome, WebhookTransport } from '../domain/transport';

export interface DispatchResult {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly attempt: number;
  readonly outcome: AttemptOutcome;
  readonly statusCode: number | null;
  readonly durationMs: number;
  /** Null when the delivery reached a terminal state. */
  readonly nextAttemptAt: Date | null;
  readonly exhausted: boolean;
  /** Set when this attempt moved the endpoint's circuit breaker. */
  readonly circuitState: CircuitState | null;
  readonly circuitChanged: boolean;
}

/**
 * Sends one claimed delivery and decides what happens next.
 *
 * The body is identical on every attempt, including replays: the attempt number and the delivery
 * id travel in headers instead. That keeps the signed bytes stable, so a consumer can compare or
 * cache a payload across retries, and makes deduplication by `Hookline-Event-Id` the obvious
 * contract for a system that guarantees at-least-once delivery.
 */
@Injectable()
export class DeliveryDispatcher {
  private readonly logger = new Logger(DeliveryDispatcher.name);

  constructor(
    private readonly queue: DeliveryQueue,
    private readonly transport: WebhookTransport,
    private readonly health: EndpointHealthRepository,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async dispatch(claimed: ClaimedDelivery): Promise<DispatchResult> {
    const startedAt = this.clock.now();
    const body = JSON.stringify({
      id: claimed.eventId,
      type: claimed.eventType,
      occurredAt: claimed.occurredAt.toISOString(),
      partitionKey: claimed.partitionKey,
      data: claimed.eventPayload,
    });

    const outcome = claimed.signingSecrets.length
      ? await this.transport.send({
          url: claimed.endpointUrl,
          body,
          headers: this.buildHeaders(claimed, body, startedAt),
          timeoutMs: Math.min(claimed.timeoutMs, this.config.dispatch.requestTimeoutMs),
        })
      : missingSecretOutcome();

    return this.settle(claimed, outcome, startedAt, body);
  }

  private buildHeaders(
    claimed: ClaimedDelivery,
    body: string,
    startedAt: Date,
  ): Record<string, string> {
    const timestamp = Math.floor(startedAt.getTime() / 1000);
    return {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: buildSignatureHeader({
        payload: body,
        secrets: claimed.signingSecrets,
        timestamp,
      }),
      'hookline-timestamp': String(timestamp),
      'hookline-event-id': claimed.eventId,
      'hookline-event-type': claimed.eventType,
      'hookline-delivery-id': claimed.deliveryId,
      'hookline-attempt': String(claimed.attempt),
      'x-request-id': `dlv_${claimed.deliveryId}_${claimed.attempt}`,
    };
  }

  private async settle(
    claimed: ClaimedDelivery,
    outcome: TransportOutcome,
    startedAt: Date,
    body: string,
  ): Promise<DispatchResult> {
    const attempt = classifyOutcome(outcome);
    const exhausted = claimed.attempt >= claimed.maxAttempts;
    const nextAttemptAt =
      attempt.outcome === 'succeeded' || exhausted
        ? null
        : this.scheduleRetry(claimed.attempt, attempt.responseHeaders);

    await this.queue.complete({
      deliveryId: claimed.deliveryId,
      attempt,
      attemptNumber: claimed.attempt,
      startedAt,
      // Stored so a consumer dispute can be settled without re-signing. The secret is never here.
      requestHeaders: this.buildHeaders(claimed, body, startedAt),
      nextAttemptAt,
    });

    /*
     * The breaker is updated after the delivery is settled, so a destination that is down stops
     * receiving the rest of its backlog within a few attempts instead of absorbing the whole
     * queue. A success closes it immediately: the destination answered, so there is nothing left
     * to protect.
     */
    const transition =
      attempt.outcome === 'succeeded'
        ? await this.health.recordSuccess(claimed.endpointId, startedAt)
        : await this.health.recordFailure(claimed.endpointId, startedAt, DEFAULT_BREAKER);

    const result: DispatchResult = {
      deliveryId: claimed.deliveryId,
      endpointId: claimed.endpointId,
      attempt: claimed.attempt,
      outcome: attempt.outcome,
      statusCode: attempt.statusCode,
      durationMs: attempt.durationMs,
      nextAttemptAt,
      exhausted: attempt.outcome !== 'succeeded' && exhausted,
      circuitState: transition?.health.circuitState ?? null,
      circuitChanged: transition?.changed ?? false,
    };

    if (transition?.changed)
      this.logger.warn({
        message: 'endpoint.circuit_changed',
        endpointId: claimed.endpointId,
        endpoint: claimed.endpointName,
        from: transition.previous,
        to: transition.health.circuitState,
        consecutiveFailures: transition.health.consecutiveFailures,
        retryAt: transition.health.circuitRetryAt?.toISOString() ?? null,
      });

    this.logger.log({
      message: 'delivery.attempted',
      deliveryId: result.deliveryId,
      endpoint: claimed.endpointName,
      eventType: claimed.eventType,
      attempt: `${claimed.attempt}/${claimed.maxAttempts}`,
      outcome: result.outcome,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      retryAt: nextAttemptAt?.toISOString() ?? null,
      error: attempt.errorReason,
    });

    return result;
  }

  /** Honours a destination's `Retry-After` when it sent one, and falls back to the backoff curve. */
  private scheduleRetry(attempt: number, responseHeaders: Record<string, string>): Date {
    const now = this.clock.now();
    const requested = parseRetryAfter(responseHeaders['retry-after'], now, DEFAULT_BACKOFF);
    const seconds = requested ?? nextDelaySeconds(attempt, DEFAULT_BACKOFF);
    return new Date(now.getTime() + seconds * 1000);
  }
}

/**
 * An endpoint with no active secret cannot be signed for, and sending unsigned would silently
 * weaken the contract every consumer relies on. It is recorded as a failed attempt so the
 * condition is visible in the delivery history instead of stalling the queue.
 */
function missingSecretOutcome(): TransportOutcome {
  return {
    kind: 'transport_error',
    durationMs: 0,
    reason: 'no_signing_secret',
    message: 'The endpoint has no active signing secret, so the request was not sent.',
  };
}
