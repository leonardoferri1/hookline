import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_BUCKET_SECONDS,
  MIN_BUCKET_SECONDS,
  TIMELINE_POINTS,
  bucketSecondsFor,
  errorRateOf,
} from '../../src/modules/metrics/domain/metrics';

test('keeps the timeline at a readable number of points', () => {
  for (const windowMinutes of [5, 15, 60, 180, 720, 1440]) {
    const bucket = bucketSecondsFor(windowMinutes);
    const points = (windowMinutes * 60) / bucket;
    assert.ok(points <= TIMELINE_POINTS + 1, `${windowMinutes}min produced ${points} points`);
    assert.ok(bucket >= MIN_BUCKET_SECONDS && bucket <= MAX_BUCKET_SECONDS, `${bucket}s`);
  }
});

test('does not shrink buckets below the floor for a very short window', () => {
  assert.equal(bucketSecondsFor(1), MIN_BUCKET_SECONDS);
  assert.equal(bucketSecondsFor(5), MIN_BUCKET_SECONDS);
  assert.equal(bucketSecondsFor(60), 60);
});

test('reports a zero error rate for an idle window instead of dividing by zero', () => {
  assert.equal(errorRateOf({ attempts: 0, succeeded: 0, rejected: 0, transportErrors: 0 }), 0);
});

test('counts rejections and transport errors alike against the error rate', () => {
  assert.equal(errorRateOf({ attempts: 10, succeeded: 8, rejected: 1, transportErrors: 1 }), 0.2);
  assert.equal(errorRateOf({ attempts: 4, succeeded: 0, rejected: 2, transportErrors: 2 }), 1);
  assert.equal(errorRateOf({ attempts: 3, succeeded: 3, rejected: 0, transportErrors: 0 }), 0);
});
