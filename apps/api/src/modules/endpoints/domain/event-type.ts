import { ValidationError } from '../../../shared/errors/domain-error';

/**
 * Event types are lowercase, dot-separated names: `order.paid`, `invoice.payment_failed` is
 * written `invoice.payment-failed`. Underscores are excluded on purpose: subscription patterns are
 * matched with SQL `LIKE`, where `_` is a single-character wildcard, and a name that silently
 * widens a subscription is worse than a naming rule.
 */
const EVENT_TYPE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

/** A subscription is `*`, an exact event type, or a prefix followed by `.*`. */
const PATTERN =
  /^(?:\*|[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\.\*|[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+)$/;

export const MAX_EVENT_TYPE_LENGTH = 100;

export function isEventType(value: string): boolean {
  return value.length <= MAX_EVENT_TYPE_LENGTH && EVENT_TYPE.test(value);
}

export function isSubscriptionPattern(value: string): boolean {
  return value.length <= MAX_EVENT_TYPE_LENGTH && PATTERN.test(value);
}

export function assertSubscriptionPatterns(patterns: readonly string[]): void {
  if (patterns.length === 0)
    throw new ValidationError('An endpoint must subscribe to at least one event type.');
  const invalid = patterns.filter((pattern) => !isSubscriptionPattern(pattern));
  if (invalid.length > 0)
    throw new ValidationError(
      'Subscriptions must be an exact event type, a prefix ending in ".*", or "*".',
      { invalid },
    );
}

/** Matching rule mirrored by the fan-out query in `postgres-endpoint.repository.ts`. */
export function matchesSubscription(pattern: string, eventType: string): boolean {
  if (pattern === '*') return true;
  if (pattern === eventType) return true;
  if (pattern.endsWith('.*')) return eventType.startsWith(pattern.slice(0, -1));
  return false;
}

export function subscriptionMatches(patterns: readonly string[], eventType: string): boolean {
  return patterns.some((pattern) => matchesSubscription(pattern, eventType));
}
