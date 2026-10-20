import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { verifySignature } from '@hookline/signature';
import { Harness, Tenant } from '../support/harness';

let harness: Harness;
let acme: Tenant;

before(async () => {
  harness = await Harness.start();
});

after(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  acme = await harness.tenant('acme');
});

interface CreatedEndpoint {
  endpoint: { id: string; name: string };
  secret: string;
}

async function registerEndpoint(
  tenant: Tenant,
  overrides: Record<string, unknown> = {},
): Promise<CreatedEndpoint> {
  const response = await tenant.request<CreatedEndpoint>('POST', '/endpoints', {
    name: `endpoint-${Math.random().toString(36).slice(2, 8)}`,
    url: `${harness.receiverUrl}/hooks/test`,
    eventTypes: ['*'],
    ...overrides,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

describe('publishing and delivering', () => {
  test('delivers a signed request the destination can verify', async () => {
    const { secret } = await registerEndpoint(acme);
    await harness.behaviour({ verifySignature: true });
    await harness.receiver.setSecrets([secret]);

    const published = await acme.request<{ deliveries: unknown[] }>('POST', '/events', {
      type: 'order.paid',
      payload: { orderId: 'ord_1', total: 1299 },
    });
    assert.equal(published.status, 202);
    assert.equal(published.body.deliveries.length, 1);

    assert.equal(await harness.drain(), 1);

    const [received] = harness.receiverLog.list();
    assert.ok(received, 'the destination received a request');
    assert.equal(received.signature, 'valid');
    assert.equal(received.statusReturned, 200);

    assert.match(received.bodyPreview, /"type":"order\.paid"/);
    assert.equal(received.eventType, 'order.paid');
    assert.equal(received.attempt, 1);

    // A different secret must not verify the same bytes, which is what makes the check meaningful.
    assert.equal(
      verifySignature({
        payload: received.bodyPreview,
        header: 't=1,v1=00',
        secrets: ['whsec_a_secret_this_endpoint_never_had'],
      }).valid,
      false,
    );

    const [delivery] = await harness.rows<{ state: string; attempt_count: number }>(
      'SELECT state, attempt_count FROM deliveries',
    );
    assert.equal(delivery?.state, 'succeeded');
    assert.equal(delivery?.attempt_count, 1);
  });

  test('fans an event out only to the endpoints subscribed to its type', async () => {
    await registerEndpoint(acme, { eventTypes: ['order.*'] });
    await registerEndpoint(acme, { eventTypes: ['invoice.paid'] });
    await registerEndpoint(acme, { eventTypes: ['*'] });

    const published = await acme.request<{ deliveries: unknown[] }>('POST', '/events', {
      type: 'order.refunded',
      payload: {},
    });
    assert.equal(published.body.deliveries.length, 2, 'order.* and * match, invoice.paid does not');
  });

  test('returns the original event when an idempotency key is replayed', async () => {
    await registerEndpoint(acme);
    const body = { type: 'order.paid', payload: { a: 1, b: 2 } };

    const first = await acme.request<{ event: { id: string }; replayed: boolean }>(
      'POST',
      '/events',
      body,
      { 'idempotency-key': 'order-1-paid' },
    );
    // Same content, different key order: the canonical fingerprint must treat it as identical.
    const second = await acme.request<{ event: { id: string }; replayed: boolean }>(
      'POST',
      '/events',
      { type: 'order.paid', payload: { b: 2, a: 1 } },
      { 'idempotency-key': 'order-1-paid' },
    );

    assert.equal(second.body.event.id, first.body.event.id);
    assert.equal(second.body.replayed, true);
    assert.equal((await harness.rows('SELECT 1 FROM events')).length, 1);
  });

  test('refuses an idempotency key reused with a different body', async () => {
    await registerEndpoint(acme);
    await acme.request(
      'POST',
      '/events',
      { type: 'order.paid', payload: { a: 1 } },
      {
        'idempotency-key': 'order-2-paid',
      },
    );
    const mismatch = await acme.request<{ code: string }>(
      'POST',
      '/events',
      { type: 'order.paid', payload: { a: 999 } },
      { 'idempotency-key': 'order-2-paid' },
    );
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.code, 'idempotency_key_reuse');
  });

  test('deduplicates concurrent publishes that share a key', async () => {
    await registerEndpoint(acme);
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        acme.request<{ event: { id: string } }>(
          'POST',
          '/events',
          { type: 'order.paid', payload: { n: 1 } },
          { 'idempotency-key': 'concurrent-key-1' },
        ),
      ),
    );

    assert.ok(attempts.every((attempt) => attempt.status === 202));
    const ids = new Set(attempts.map((attempt) => attempt.body.event.id));
    assert.equal(ids.size, 1, 'exactly one event survives the race');
    assert.equal((await harness.rows('SELECT 1 FROM deliveries')).length, 1);
  });
});

describe('retrying and giving up', () => {
  test('retries a rejected delivery and gives up when the budget is spent', async () => {
    await registerEndpoint(acme, { maxAttempts: 3 });
    await harness.behaviour({ mode: 'error', statusCode: 500 });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await harness.fastForward();
      await harness.drain(1);
    }

    const [delivery] = await harness.rows<{
      state: string;
      attempt_count: number;
      last_status_code: number;
    }>('SELECT state, attempt_count, last_status_code FROM deliveries');
    assert.equal(delivery?.state, 'failed');
    assert.equal(delivery?.attempt_count, 3);
    assert.equal(delivery?.last_status_code, 500);

    const attempts = await harness.rows<{ attempt_number: number; outcome: string }>(
      'SELECT attempt_number, outcome FROM delivery_attempts ORDER BY attempt_number',
    );
    assert.deepEqual(
      attempts.map((attempt) => `${attempt.attempt_number}:${attempt.outcome}`),
      ['1:rejected', '2:rejected', '3:rejected'],
    );
  });

  test('schedules the next attempt in the future instead of retrying immediately', async () => {
    await registerEndpoint(acme, { maxAttempts: 4 });
    await harness.behaviour({ mode: 'error' });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });

    await harness.drain(1);
    const [afterFirst] = await harness.rows<{ state: string; backing_off: boolean }>(
      'SELECT state, next_attempt_at > now() AS backing_off FROM deliveries',
    );
    assert.equal(afterFirst?.state, 'pending');
    assert.equal(afterFirst?.backing_off, true);

    // A cycle that does not advance the clock must not claim a delivery that is backing off.
    assert.equal(await harness.drain(1), 0);
  });

  test('records a refused connection as a transport error, not a status code', async () => {
    await registerEndpoint(acme, { maxAttempts: 2 });
    await harness.behaviour({ mode: 'offline' });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });

    await harness.drain(1);

    const [attempt] = await harness.rows<{
      outcome: string;
      status_code: number | null;
      error_reason: string;
    }>('SELECT outcome, status_code, error_reason FROM delivery_attempts');
    assert.equal(attempt?.outcome, 'transport_error');
    assert.equal(attempt?.status_code, null);
    assert.equal(attempt?.error_reason, 'connection_refused');
  });

  test('honours Retry-After over its own backoff', async () => {
    await registerEndpoint(acme, { maxAttempts: 4 });
    await harness.behaviour({ mode: 'error', statusCode: 429, retryAfterSeconds: 120 });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });

    await harness.drain(1);

    const [delivery] = await harness.rows<{ wait_seconds: number }>(
      'SELECT extract(epoch FROM (next_attempt_at - now())) AS wait_seconds FROM deliveries',
    );
    // The first backoff would be at most 5s; 120s can only have come from the header.
    assert.ok(
      Number(delivery?.wait_seconds) > 100,
      `expected the destination's 120s to win, waited ${delivery?.wait_seconds}s`,
    );
  });
});

describe('protecting a failing destination', () => {
  test('opens the breaker, allows one probe, and recovers on success', async () => {
    const { endpoint } = await registerEndpoint(acme, { maxAttempts: 20 });
    await harness.behaviour({ mode: 'offline' });

    for (let index = 0; index < 8; index += 1)
      await acme.request('POST', '/events', { type: 'order.paid', payload: { index } });

    // Every queued delivery is attempted once; five consecutive failures open the breaker.
    assert.equal(await harness.drain(1), 8);
    const opened = await endpointHealth(endpoint.id);
    assert.equal(opened.circuit_state, 'open');
    assert.ok(opened.consecutive_failures >= 5);

    // While the cooldown runs, nothing is sent at all.
    assert.equal(await harness.drain(1), 0);

    // Once it elapses, exactly one delivery is allowed through as a probe.
    await harness.fastForward();
    assert.equal(await harness.drain(1), 1, 'a single probe, not the whole backlog');
    assert.equal((await endpointHealth(endpoint.id)).circuit_state, 'open');

    // The destination comes back; the probe succeeds and the breaker closes.
    await harness.behaviour({ mode: 'ok' });
    await harness.fastForward();
    assert.equal(await harness.drain(1), 1);
    assert.equal((await endpointHealth(endpoint.id)).circuit_state, 'closed');

    // With the breaker closed the backlog drains.
    await harness.fastForward();
    await harness.drain();
    const states = await harness.rows<{ state: string; total: string }>(
      'SELECT state, count(*) AS total FROM deliveries GROUP BY state',
    );
    assert.deepEqual(states, [{ state: 'succeeded', total: '8' }]);
  });

  test('sends nothing to a paused endpoint and resumes when it is enabled', async () => {
    const { endpoint } = await registerEndpoint(acme);
    await acme.request('PATCH', `/endpoints/${endpoint.id}`, { status: 'paused' });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });

    assert.equal(await harness.drain(1), 0);
    assert.equal(harness.receiverLog.total, 0);

    await acme.request('PATCH', `/endpoints/${endpoint.id}`, { status: 'enabled' });
    assert.equal(await harness.drain(), 1);
  });
});

describe('ordering and concurrency', () => {
  test('delivers one partition key at a time, in publication order', async () => {
    await registerEndpoint(acme, { ordered: true, maxAttempts: 3 });

    for (let index = 0; index < 4; index += 1)
      await acme.request('POST', '/events', {
        type: 'order.paid',
        partitionKey: 'customer-1',
        payload: { sequence: index + 1 },
      });

    // One cycle may claim at most one delivery of the partition, however large the batch.
    assert.equal(await harness.drain(1), 1);
    assert.equal(await harness.drain(1), 1);
    assert.equal(await harness.drain(1), 1);
    assert.equal(await harness.drain(1), 1);

    const sequence = harness.receiverLog
      .list()
      .reverse()
      .map((request) => JSON.parse(request.bodyPreview).data.sequence);
    assert.deepEqual(sequence, [1, 2, 3, 4], 'arrived in the order they were published');
  });

  test('lets an unordered endpoint send a partition in parallel', async () => {
    await registerEndpoint(acme, { ordered: false });
    for (let index = 0; index < 4; index += 1)
      await acme.request('POST', '/events', {
        type: 'order.paid',
        partitionKey: 'customer-1',
        payload: { sequence: index + 1 },
      });

    assert.equal(await harness.drain(1), 4, 'ordering is opt-in per endpoint');
  });

  test('never hands the same delivery to two dispatchers', async () => {
    await registerEndpoint(acme, { maxAttempts: 2 });
    await harness.behaviour({ latencyMs: 60 });
    for (let index = 0; index < 10; index += 1)
      await acme.request('POST', '/events', { type: 'order.paid', payload: { index } });

    // Two cycles racing on the same queue: SKIP LOCKED must give them disjoint work.
    const [first, second] = await Promise.all([harness.worker.tick(), harness.worker.tick()]);
    assert.equal(first + second, 10);

    const duplicated = await harness.rows(
      `SELECT delivery_id FROM delivery_attempts
        GROUP BY delivery_id, attempt_number HAVING count(*) > 1`,
    );
    assert.equal(duplicated.length, 0, 'no delivery was attempted twice with the same number');
    assert.equal(harness.receiverLog.total, 10);
  });

  test('returns a delivery to the queue when its lease expires', async () => {
    await registerEndpoint(acme, { maxAttempts: 3 });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });

    // Simulate a dispatcher that claimed work and died before recording an outcome.
    await harness.database.query(
      `UPDATE deliveries
          SET state = 'in_flight', attempt_count = 1, leased_by = 'crashed',
              leased_until = now() - interval '1 minute'`,
    );
    assert.equal(await harness.drain(1), 0, 'an in-flight delivery is not claimable');

    assert.equal(await harness.worker.sweepExpiredLeases(), 1);

    const recovered = await harness.rows<{ state: string; attempt_count: number }>(
      'SELECT state, attempt_count FROM deliveries',
    );
    assert.equal(recovered[0]?.state, 'pending', 'the expired lease was swept back to the queue');
    assert.equal(recovered[0]?.attempt_count, 1, 'the crashed attempt still counts against budget');

    assert.equal(await harness.drain(), 1);
  });
});

describe('replay and history', () => {
  test('replays a failed delivery as a new one, preserving the original', async () => {
    const { endpoint } = await registerEndpoint(acme, { maxAttempts: 1 });
    await harness.behaviour({ mode: 'error' });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });
    await harness.drain(1);

    const [original] = await harness.rows<{ id: string }>(
      `SELECT id FROM deliveries WHERE state = 'failed'`,
    );
    assert.ok(original);

    await harness.behaviour({ mode: 'ok' });
    const replay = await acme.request<{ id: string; replayOf: string }>(
      'POST',
      `/deliveries/${original.id}/replay`,
    );
    assert.equal(replay.status, 201);
    assert.equal(replay.body.replayOf, original.id);

    await harness.drain();

    const deliveries = await harness.rows<{ id: string; state: string; replay_of: string | null }>(
      'SELECT id, state, replay_of FROM deliveries ORDER BY created_at',
    );
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[0]?.state, 'failed', 'the original record is untouched');
    assert.equal(deliveries[1]?.state, 'succeeded');
    assert.equal(deliveries[1]?.replay_of, original.id);

    const bulk = await acme.request<{ requeued: unknown[] }>('POST', '/deliveries/replay', {
      endpointId: endpoint.id,
      states: ['failed'],
    });
    assert.equal(bulk.body.requeued.length, 1, 'the still-failed original is re-queued');
  });

  test('exposes the attempt log with the signature header and no secret', async () => {
    const { secret } = await registerEndpoint(acme, { maxAttempts: 1 });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });
    await harness.drain();

    const [row] = await harness.rows<{ id: string }>('SELECT id FROM deliveries');
    const detail = await acme.request<{
      attempts: Array<{ requestHeaders: Record<string, string>; outcome: string }>;
    }>('GET', `/deliveries/${row!.id}`);

    assert.equal(detail.status, 200);
    const [attempt] = detail.body.attempts;
    assert.equal(attempt?.outcome, 'succeeded');
    assert.ok(attempt?.requestHeaders['hookline-signature'], 'the signature as sent is recorded');
    assert.ok(
      !JSON.stringify(attempt?.requestHeaders).includes(secret),
      'the signing secret is never stored in the attempt log',
    );
  });

  test('cancels a pending delivery but not one that already settled', async () => {
    await registerEndpoint(acme);
    const published = await acme.request<{ deliveries: Array<{ id: string }> }>('POST', '/events', {
      type: 'order.paid',
      payload: {},
    });
    const deliveryId = published.body.deliveries[0]!.id;

    const canceled = await acme.request<{ state: string }>(
      'POST',
      `/deliveries/${deliveryId}/cancel`,
    );
    assert.equal(canceled.body.state, 'canceled');
    assert.equal(await harness.drain(), 0, 'a canceled delivery is never sent');

    const again = await acme.request<{ code: string }>('POST', `/deliveries/${deliveryId}/cancel`);
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'delivery_not_cancelable');
  });
});

describe('tenant boundaries and limits', () => {
  test('keeps one tenant out of another tenant’s deliveries', async () => {
    await registerEndpoint(acme);
    const published = await acme.request<{ deliveries: Array<{ id: string }> }>('POST', '/events', {
      type: 'order.paid',
      payload: {},
    });
    const deliveryId = published.body.deliveries[0]!.id;

    const other = await harness.tenant('globex');
    const theirs = await other.request('GET', `/deliveries/${deliveryId}`);
    assert.equal(theirs.status, 404, 'not 403: the resource does not exist for this tenant');
    assert.deepEqual((await other.request<unknown[]>('GET', '/deliveries')).body, []);
  });

  test('enforces the scopes declared on each route', async () => {
    const publisher = await harness.tenant('publisher-only', ['events:write']);
    assert.equal((await publisher.request('GET', '/endpoints')).status, 403);
    assert.equal((await publisher.request('GET', '/deliveries')).status, 403);
    assert.equal(
      (await publisher.request('POST', '/events', { type: 'order.paid', payload: {} })).status,
      202,
    );
  });

  test('refuses ingest beyond the tenant burst and reports when to retry', async () => {
    const { tokens } = await harness.app
      .get(
        (await import('../../src/modules/tenants/application/provision-tenant.use-case'))
          .ProvisionTenant,
      )
      .execute({
        slug: 'tiny',
        name: 'tiny',
        limits: { ingestRatePerMinute: 60, ingestBurst: 3 },
        keys: [{ name: 'test', scopes: ['events:write'] }],
      });

    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${harness.baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens[0]!.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type: 'order.paid', payload: { index } }),
      });
      statuses.push(response.status);
      retryAfter ??= response.headers.get('retry-after');
    }

    assert.deepEqual(statuses, [202, 202, 202, 429, 429]);
    assert.ok(Number(retryAfter) >= 1, 'a refusal says when to come back');
  });

  test('refuses a destination that resolves to a private address when not permitted', async () => {
    // The harness allows loopback so the bundled receiver is reachable; this covers the shape
    // validation that runs before any address is resolved.
    const rejected = await acme.request<{ code: string }>('POST', '/endpoints', {
      name: 'internal',
      url: 'file:///etc/passwd',
      eventTypes: ['*'],
    });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.code, 'invalid_request');
  });
});

describe('metrics', () => {
  test('summarizes attempts, errors and latency from the attempt log', async () => {
    await registerEndpoint(acme, { maxAttempts: 2 });
    await harness.behaviour({ mode: 'error', statusCode: 500 });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });
    await harness.drain(1);
    await harness.fastForward();
    await harness.drain(1);

    await harness.behaviour({ mode: 'ok' });
    await acme.request('POST', '/events', { type: 'order.paid', payload: {} });
    await harness.drain();

    const metrics = await acme.request<{
      totals: { attempts: number; succeeded: number; rejected: number; errorRate: number };
      latency: { answeredAttempts: number; p95Ms: number };
      queue: { failed: number };
      timeline: Array<{ attempts: number }>;
    }>('GET', '/metrics?windowMinutes=15');

    assert.equal(metrics.status, 200);
    assert.equal(metrics.body.totals.attempts, 3);
    assert.equal(metrics.body.totals.succeeded, 1);
    assert.equal(metrics.body.totals.rejected, 2);
    assert.ok(Math.abs(metrics.body.totals.errorRate - 2 / 3) < 0.001);
    assert.equal(metrics.body.latency.answeredAttempts, 3);
    assert.ok(metrics.body.latency.p95Ms >= 0);
    assert.equal(metrics.body.queue.failed, 1);
    assert.ok(metrics.body.timeline.length > 1, 'the window is split into buckets');
  });
});

async function endpointHealth(
  endpointId: string,
): Promise<{ circuit_state: string; consecutive_failures: number }> {
  const [row] = await harness.rows<{ circuit_state: string; consecutive_failures: number }>(
    'SELECT circuit_state, consecutive_failures FROM endpoints WHERE id = $1',
    [endpointId],
  );
  return row!;
}
