import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isEventType,
  isSubscriptionPattern,
  matchesSubscription,
  subscriptionMatches,
} from '../../src/modules/endpoints/domain/event-type';
import { normalizeDestinationUrl } from '../../src/modules/endpoints/domain/destination-url';

test('accepts dotted lowercase event types', () => {
  for (const value of ['order.paid', 'invoice.payment-failed', 'a.b.c.d'])
    assert.equal(isEventType(value), true, value);
});

test('rejects event type shapes that would break subscription matching', () => {
  for (const value of ['order', 'Order.Paid', 'order.', '.paid', 'order..paid', 'order_paid.x', ''])
    assert.equal(isEventType(value), false, value);
});

test('accepts the three subscription forms', () => {
  for (const value of ['*', 'order.*', 'order.paid', 'billing.invoice.*'])
    assert.equal(isSubscriptionPattern(value), true, value);
});

test('rejects subscription patterns with a wildcard anywhere but the end', () => {
  for (const value of ['*.paid', 'order.*.paid', 'order*', '**', 'order.pa*d'])
    assert.equal(isSubscriptionPattern(value), false, value);
});

test('matches exactly, by prefix, and globally', () => {
  assert.equal(matchesSubscription('order.paid', 'order.paid'), true);
  assert.equal(matchesSubscription('order.paid', 'order.refunded'), false);
  assert.equal(matchesSubscription('order.*', 'order.paid'), true);
  assert.equal(matchesSubscription('order.*', 'order.line.added'), true);
  assert.equal(matchesSubscription('*', 'anything.at-all'), true);
});

test('a prefix pattern does not match a sibling that merely starts with the same letters', () => {
  assert.equal(matchesSubscription('order.*', 'orders.paid'), false);
  assert.equal(matchesSubscription('order.*', 'order'), false);
});

test('an endpoint matches when any of its subscriptions matches', () => {
  const patterns = ['invoice.paid', 'order.*'];
  assert.equal(subscriptionMatches(patterns, 'order.refunded'), true);
  assert.equal(subscriptionMatches(patterns, 'invoice.paid'), true);
  assert.equal(subscriptionMatches(patterns, 'invoice.voided'), false);
});

test('normalizes acceptable destination URLs', () => {
  assert.equal(
    normalizeDestinationUrl('  http://127.0.0.1:3022/hooks/billing  '),
    'http://127.0.0.1:3022/hooks/billing',
  );
  assert.equal(
    normalizeDestinationUrl('https://example.test/webhooks?tenant=acme'),
    'https://example.test/webhooks?tenant=acme',
  );
});

test('refuses destination URLs that cannot be delivered to safely', () => {
  const rejected = [
    'ftp://example.test/hook',
    'file:///etc/passwd',
    'https://user:pass@example.test/hook',
    'https://example.test/hook#fragment',
    'not-a-url',
    '',
  ];
  for (const value of rejected)
    assert.throws(() => normalizeDestinationUrl(value), /URL/i, `expected ${value} to be refused`);
});
