import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_BACKOFF,
  nextDelaySeconds,
  parseRetryAfter,
} from '../../src/modules/dispatch/domain/backoff';

const lowest = () => 0;
const highest = () => 1;

test('grows the delay exponentially from the first retry', () => {
  // Half the delay is fixed, so random() = 0 exposes the deterministic floor: 5, 15, 45, 135 s.
  assert.equal(nextDelaySeconds(1, DEFAULT_BACKOFF, lowest), 2.5);
  assert.equal(nextDelaySeconds(2, DEFAULT_BACKOFF, lowest), 7.5);
  assert.equal(nextDelaySeconds(3, DEFAULT_BACKOFF, lowest), 22.5);
  assert.equal(nextDelaySeconds(4, DEFAULT_BACKOFF, lowest), 67.5);
});

test('spreads each delay over a bounded window', () => {
  for (const attempt of [1, 2, 3, 4, 5]) {
    const floor = nextDelaySeconds(attempt, DEFAULT_BACKOFF, lowest);
    const ceiling = nextDelaySeconds(attempt, DEFAULT_BACKOFF, highest);
    assert.equal(ceiling, floor * 2, `attempt ${attempt} window`);
    const sample = nextDelaySeconds(attempt, DEFAULT_BACKOFF, () => 0.5);
    assert.ok(sample >= floor && sample <= ceiling, `attempt ${attempt} sample within window`);
  }
});

test('never exceeds the ceiling, however many attempts have passed', () => {
  for (const attempt of [8, 12, 40, 500])
    assert.ok(
      nextDelaySeconds(attempt, DEFAULT_BACKOFF, highest) <= DEFAULT_BACKOFF.maxSeconds,
      `attempt ${attempt}`,
    );
  assert.equal(nextDelaySeconds(40, DEFAULT_BACKOFF, highest), DEFAULT_BACKOFF.maxSeconds);
});

test('treats the first attempt as the base delay', () => {
  const noJitter = { ...DEFAULT_BACKOFF, jitter: 0 };
  assert.equal(nextDelaySeconds(1, noJitter), 5);
  assert.equal(nextDelaySeconds(0, noJitter), 5);
  assert.equal(nextDelaySeconds(-3, noJitter), 5);
});

test('honours Retry-After given in seconds', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  assert.equal(parseRetryAfter('30', now), 30);
  assert.equal(parseRetryAfter('  0  ', now), 0);
});

test('honours Retry-After given as an HTTP date', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  assert.equal(parseRetryAfter('Tue, 20 Oct 2026 12:00:45 GMT', now), 45);
  // A date already in the past means "come back now", not "wait a negative amount".
  assert.equal(parseRetryAfter('Tue, 20 Oct 2026 11:59:00 GMT', now), 0);
});

test('clamps a hostile Retry-After to the policy ceiling', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  assert.equal(parseRetryAfter('999999', now), DEFAULT_BACKOFF.maxSeconds);
  assert.equal(parseRetryAfter('Fri, 20 Nov 2026 12:00:00 GMT', now), DEFAULT_BACKOFF.maxSeconds);
});

test('ignores a Retry-After that cannot be read', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  for (const value of [undefined, '', 'soon', '12x', 'NaN'])
    assert.equal(parseRetryAfter(value, now), null, String(value));
});
