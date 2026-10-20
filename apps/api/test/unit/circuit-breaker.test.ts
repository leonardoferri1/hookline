import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_BREAKER,
  cooldownSeconds,
  opensAfterFailure,
} from '../../src/modules/dispatch/domain/circuit-breaker';

test('holds the base cooldown until the threshold is passed', () => {
  for (const failures of [0, 1, 3, 5])
    assert.equal(cooldownSeconds(failures), DEFAULT_BREAKER.baseCooldownSeconds, `${failures}`);
});

test('doubles the cooldown for each failure past the threshold', () => {
  assert.equal(cooldownSeconds(6), 60);
  assert.equal(cooldownSeconds(7), 120);
  assert.equal(cooldownSeconds(8), 240);
  assert.equal(cooldownSeconds(9), 480);
});

test('caps the cooldown however long a destination stays down', () => {
  for (const failures of [10, 20, 100])
    assert.equal(cooldownSeconds(failures), DEFAULT_BREAKER.maxCooldownSeconds, `${failures}`);
});

test('keeps a closed breaker closed below the threshold', () => {
  for (const failures of [1, 2, 3, 4]) assert.equal(opensAfterFailure('closed', failures), false);
  assert.equal(opensAfterFailure('closed', 5), true);
  assert.equal(opensAfterFailure('closed', 9), true);
});

test('re-opens immediately when a probe fails', () => {
  // The probe exists to answer whether the destination recovered; one failed answer settles it.
  assert.equal(opensAfterFailure('half_open', 1), true);
  assert.equal(opensAfterFailure('open', 1), true);
});

test('respects a custom policy', () => {
  const policy = { failureThreshold: 2, baseCooldownSeconds: 10, maxCooldownSeconds: 40 };
  assert.equal(opensAfterFailure('closed', 1, policy), false);
  assert.equal(opensAfterFailure('closed', 2, policy), true);
  assert.equal(cooldownSeconds(2, policy), 10);
  assert.equal(cooldownSeconds(3, policy), 20);
  assert.equal(cooldownSeconds(4, policy), 40);
  assert.equal(cooldownSeconds(5, policy), 40);
});
