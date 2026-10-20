# API

Base URL `http://127.0.0.1:3021/api/v1`. Interactive documentation, generated from the code, is at
`/api/docs`.

Authentication is a tenant API key:

```
Authorization: Bearer hk_live_<public id>_<secret>
```

Keys carry scopes. A publishing service should hold `events:write` only, so a leaked publisher key
cannot repoint a destination.

| Scope               | Allows                                           |
| ------------------- | ------------------------------------------------ |
| `events:write`      | Publish events                                   |
| `endpoints:read`    | List and inspect destinations                    |
| `endpoints:write`   | Create, update, delete, rotate secrets           |
| `deliveries:read`   | Read delivery history, attempts, events, metrics |
| `deliveries:replay` | Replay and cancel deliveries                     |

Errors are RFC 9457 problem documents:

```json
{
  "type": "https://hookline.dev/problems/idempotency_key_reuse",
  "title": "Request rejected",
  "status": 409,
  "code": "idempotency_key_reuse",
  "detail": "This idempotency key was already used with a different event body.",
  "instance": "/api/v1/events",
  "requestId": "0f3d…"
}
```

Branch on `code`, which is stable; `detail` is prose and may change.

## Publish an event

```http
POST /events
Idempotency-Key: order-1042-paid        # optional, scoped to the tenant
Content-Type: application/json

{
  "type": "order.paid",
  "payload": { "orderId": "ord_1042", "total": 12990, "currency": "BRL" },
  "partitionKey": "cus_1042",           # optional; ordering is per key
  "source": "checkout-service",         # optional label
  "occurredAt": "2026-10-20T12:30:00Z"  # optional; defaults to now
}
```

`202 Accepted` means the event and one delivery per subscribing endpoint are committed. It does not
mean anything has been sent.

```json
{
  "event": { "id": "…", "type": "order.paid", "…": "…" },
  "deliveries": [{ "id": "…", "endpointId": "…", "state": "pending", "…": "…" }],
  "replayed": false
}
```

`replayed: true` means the key matched an event already accepted; the original is returned.
A key reused with different content is `409 idempotency_key_reuse`.

Event types are lowercase dot-separated names matching
`^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$`. Underscores are excluded on purpose, since
subscriptions are matched with SQL `LIKE`.

Ingest is subject to the tenant's token bucket. A refusal is `429` with `Retry-After` and the
`RateLimit-Limit` / `RateLimit-Remaining` fields.

## Manage destinations

```http
POST /endpoints
{
  "name": "Billing service",
  "url": "https://billing.example.com/hooks",
  "eventTypes": ["order.*", "invoice.paid"],
  "maxAttempts": 6,          # 1–20, default 6
  "timeoutMs": 10000,        # 500–30000, default 10000
  "ordered": false           # deliver one partition key at a time
}
```

The response carries the signing secret **once**. It is not retrievable afterwards.

| Route                                 | Purpose                                                 |
| ------------------------------------- | ------------------------------------------------------- |
| `GET /endpoints`                      | List destinations with delivery health                  |
| `GET /endpoints/{id}`                 | One destination                                         |
| `PATCH /endpoints/{id}`               | Update; `status: "enabled"` also closes an open breaker |
| `DELETE /endpoints/{id}`              | Remove the destination and its history                  |
| `GET /endpoints/{id}/secrets`         | Secret metadata (last four characters only)             |
| `POST /endpoints/{id}/secrets/rotate` | Issue a new secret, with `graceSeconds` of overlap      |

A subscription is an exact event type, a prefix ending in `.*`, or `*`.

## Delivery history

```http
GET /deliveries?endpointId=…&state=failed&state=pending&eventType=order.paid&limit=50&before=<iso>
```

Paginate with `before`, taking the `createdAt` of the last row: an offset would shift rows under a
reader while the table grows.

| Route                             | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `GET /deliveries/{id}`            | One delivery plus every attempt made for it          |
| `POST /deliveries/{id}/replay`    | Queue a settled delivery again as a new one          |
| `POST /deliveries/{id}/cancel`    | Withdraw a delivery that has not been claimed        |
| `POST /deliveries/replay`         | Re-queue an endpoint's settled backlog, oldest first |
| `GET /events`, `GET /events/{id}` | Published events and the deliveries they produced    |

Each attempt records the signature header as sent and the response as received, truncated to the
configured cap. The signing secret is never stored.

A replay is a **new** delivery pointing at the original through `replayOf`. Resetting the original
would destroy the record of what already happened.

## Metrics

```http
GET /metrics?windowMinutes=60&endpointId=…
```

Returns totals, latency percentiles, queue depth, a per-endpoint table and a gap-filled timeline.
Percentiles cover attempts the destination answered; timeouts and refused connections are reported
as errors instead.

## Live stream

```http
GET /stream
Accept: text/event-stream
```

Emits `event.published`, `delivery.attempted` and `endpoint.circuit_changed`, plus a heartbeat
every 20 seconds. Subscriptions are per tenant.

## What a consumer receives

```http
POST /your/endpoint
Content-Type: application/json
Hookline-Signature: t=1760880000,v1=9f86d08…
Hookline-Timestamp: 1760880000
Hookline-Event-Id: 0f3d…
Hookline-Event-Type: order.paid
Hookline-Delivery-Id: 7a21…
Hookline-Attempt: 2
User-Agent: Hookline/0.1

{"id":"0f3d…","type":"order.paid","occurredAt":"…","partitionKey":"cus_1042","data":{…}}
```

Verifying, with `@hookline/signature` or by hand:

```ts
import { verifySignature } from '@hookline/signature';

const result = verifySignature({
  payload: rawBody, // the exact bytes received, not a re-serialized object
  header: request.headers['hookline-signature'],
  secrets: [currentSecret, previousSecret], // both, during a rotation
});

if (!result.valid) return reply.status(401).send({ reason: result.reason });
```

By hand: take `t` from the header, compute `HMAC-SHA256(secret, "${t}.${rawBody}")` as hex, compare
in constant time against any `v1` entry, and reject a timestamp more than five minutes old.

**Contract for consumers.** Delivery is at-least-once, so deduplicate on `Hookline-Event-Id`. Any
2xx counts as delivered; anything else is retried until the endpoint's budget is spent. Answer
quickly and do the work asynchronously — the timeout is the endpoint's `timeoutMs`. Sending
`Retry-After` on a 429 or 503 is honoured over the computed backoff.
