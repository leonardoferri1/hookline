import assert from 'node:assert/strict';
import { test } from 'node:test';
import { secondsUntilAvailable } from '../../src/modules/limits/domain/rate-limiter';

test('does not ask the caller to wait when tokens are available', () => {
  assert.equal(secondsUntilAvailable(5, 1, 60), 0);
  assert.equal(secondsUntilAvailable(1, 1, 60), 0);
});

test('rounds the wait up to the next whole second', () => {
  // 60 tokens per minute restores one token per second.
  assert.equal(secondsUntilAvailable(0, 1, 60), 1);
  assert.equal(secondsUntilAvailable(0.5, 1, 60), 1);
  // 30 tokens per minute restores one token every two seconds.
  assert.equal(secondsUntilAvailable(0, 1, 30), 2);
  assert.equal(secondsUntilAvailable(0, 3, 30), 6);
});

test('never reports a zero wait for a refusal', () => {
  assert.equal(secondsUntilAvailable(0.999, 1, 6000), 1);
});
