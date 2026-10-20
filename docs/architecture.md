# Architecture

## The shape of the problem

A webhook platform sits between two systems it does not control. On one side a publisher expects
`POST /events` to be fast and to never lose anything it acknowledged. On the other, a customer's
endpoint may be slow, broken, wrong about its own TLS, or simply absent for an hour. Everything
below follows from holding those two together.

## Modules

The API is split by module rather than by technical layer, and each module is split into four
directories:

```
modules/<name>/
  domain/          entities, value objects, repository ports, domain errors
  application/     use cases; orchestration and transaction boundaries
  infrastructure/  PostgreSQL repositories, HTTP transport
  api/             controllers, DTOs, guards
```

Repository ports are abstract classes rather than interfaces, so they double as Nest injection
tokens without a separate symbol. The application layer therefore depends on a contract and never
imports `pg`, while the controller layer never reaches past a use case.

| Module       | Responsibility                                                    |
| ------------ | ----------------------------------------------------------------- |
| `tenants`    | Tenants, scoped API keys, authentication guard                    |
| `limits`     | Per-tenant ingest quota as a PostgreSQL token bucket              |
| `endpoints`  | Destinations, subscriptions, signing secrets, delivery health     |
| `events`     | Ingest, idempotency, fan-out                                      |
| `deliveries` | Delivery records, attempt history, replay, cancellation           |
| `dispatch`   | The queue, the transport, the retry schedule, the circuit breaker |
| `metrics`    | Aggregates read from the attempt log                              |
| `stream`     | Server-sent events for the console                                |

## Ingest and fan-out

```
POST /api/v1/events
  ├─ ApiKeyGuard          authenticate, enforce scopes
  ├─ IngestRateLimitGuard charge one token to the tenant bucket
  └─ PublishEvent
       └─ one transaction
            ├─ insert the event
            └─ insert one delivery per subscribing endpoint
```

This is the outbox boundary. A `202` means the event and its queued work are committed together,
not that anything has been sent. The alternative — acknowledge, then enqueue — loses events exactly
when the process dies between the two.

**Idempotency.** With an `Idempotency-Key`, the write runs inside an advisory lock scoped to the
tenant and the key. Relying on the unique index alone is not enough: under `READ COMMITTED` the
loser of the race re-reads before the winner commits and finds nothing. The stored fingerprint
hashes a _canonical_ form of the payload, with object keys sorted, so a client that rebuilds the
same body from a map is not falsely told its key was reused, while a genuinely different body is
rejected with `idempotency_key_reuse`.

**Subscriptions.** A pattern is an exact type, a prefix ending in `.*`, or `*`. Matching happens in
SQL so ingest does not load every endpoint to filter in memory, and the SQL mirrors the domain
matcher. Event types forbid `_` precisely because the SQL uses `LIKE`, where `_` is a wildcard — a
naming rule is cheaper than a subscription that silently widens.

Paused endpoints still receive queued deliveries. Pausing means "stop sending for now", not
"unsubscribe", so a destination taken out during an incident gets what it missed when it returns.

## The dispatcher

One statement claims work, and it carries every policy decision:

```sql
WITH locked AS (
  SELECT d.id, d.endpoint_id, d.next_attempt_at, d.created_at, e.circuit_state
    FROM deliveries d JOIN endpoints e ON e.id = d.endpoint_id
   WHERE d.state = 'pending'
     AND d.next_attempt_at <= $now
     AND e.status = 'enabled'
     AND (e.circuit_state <> 'open' OR e.circuit_retry_at <= $now)
     AND (breaker is closed OR no delivery for this endpoint is in flight)
     AND (endpoint is unordered OR no sibling in this partition is in flight or older-and-pending)
   ORDER BY d.next_attempt_at, d.created_at
   LIMIT $batch
   FOR UPDATE OF d SKIP LOCKED
), ranked AS ( … row_number() per endpoint … ),
   due AS (SELECT id FROM ranked WHERE circuit_state = 'closed' OR probe_rank = 1),
   probing AS (UPDATE endpoints SET circuit_state = 'half_open' WHERE …),
   claimed AS (UPDATE deliveries SET state='in_flight', attempt_count = attempt_count + 1, …)
SELECT … FROM claimed JOIN endpoints JOIN events …
```

- **`SKIP LOCKED`** is what makes multiple dispatchers safe against each other. Each takes rows no
  one else holds instead of blocking, so throughput scales with workers and one slow destination
  never stalls the queue.
- **The lease and the attempt counter move in the same statement as the state.** A dispatcher that
  dies after claiming has already spent an attempt. The alternative is a delivery that can be
  retried forever by crashing at the right moment.
- **Ranking is in its own CTE** because PostgreSQL refuses a locking clause in a query using window
  functions. Rows that lose the ranking were locked only for the duration of the statement.
- **Ordering** blocks a delivery while a sibling in the same partition is in flight, and also while
  an older sibling is still pending even if it is only backing off. Head-of-line blocking is the
  honest cost of ordered delivery, confined to one key.

Completion writes the attempt row and the new delivery state in one transaction, so a crash cannot
lose the evidence of an attempt or leave a delivery claiming an outcome no attempt supports. The
attempt insert is idempotent on `(delivery_id, attempt_number)`.

Abandoned leases are swept back to the queue on a clock-based schedule, at half the lease duration.

## Retries and the breaker

Backoff is exponential with **equal jitter**: half the delay fixed, half random. Jitter matters
more here than in a client — when a destination recovers, everything queued against it is due at
the same instant and would arrive as one spike — while the fixed half keeps the schedule something
an operator can reason about. A destination that answers `Retry-After` is believed instead, clamped
to the policy ceiling so a hostile value cannot park a delivery for a week.

Five consecutive failures open the breaker. The cooldown doubles per failure past the threshold and
is capped, so a destination down for an hour is probed every ten minutes rather than every thirty
seconds. When the cooldown elapses the claim query admits **exactly one** delivery for that
endpoint and marks it half-open in the same statement; nothing else is claimed while that probe is
in flight. One failed probe re-opens immediately — the probe exists to answer whether the
destination recovered — and one success closes the breaker and releases the backlog.

The failure counter and cooldown are computed in a single atomic statement rather than
read-modify-write, because two dispatchers can fail against the same endpoint at once and a lost
increment would keep a dead destination's breaker closed.

## Signing

```
Hookline-Signature: t=1760880000,v1=<hex>,v1=<hex>
```

The signed string is `${timestamp}.${rawBody}`, which binds the timestamp to the payload so a
captured signature cannot be moved to a fresh one. Digests are compared in constant time, and
verification returns a machine-readable reason rather than a boolean, so a consumer can tell a
clock problem from a wrong secret.

During a rotation the header carries one `v1` entry per active secret. The consumer can adopt the
new value before the old one is retired, which is what makes rotation a non-event.

The request body is **byte-identical across attempts and replays** — the attempt number travels in
a header. That keeps the signed bytes stable and makes deduplication on `Hookline-Event-Id` the
obvious contract for an at-least-once system.

## Sending safely

A webhook sender is an HTTP client whose destination is chosen by whoever configures the endpoint,
which is the textbook setup for server-side request forgery. The transport therefore uses
`node:http` rather than `fetch`:

1. Every resolved address is classified, including IPv4-mapped IPv6 forms that reach the same
   hosts, and the cloud metadata address falls under the link-local rule.
2. The checked address is **pinned** through the `lookup` hook. A check followed by an unpinned
   connect is a DNS-rebinding hole.
3. Redirects are not followed, so a destination cannot bounce the sender to an address already
   refused.
4. The response body is read to a cap and the socket destroyed, so a destination cannot stream an
   unbounded body into the attempt log.

Loopback and private ranges are refused unless `ALLOW_PRIVATE_DESTINATIONS` is set, which the local
demonstration does because the bundled receiver lives there.

## Reading

Metrics are aggregated from `delivery_attempts` on read rather than kept in counters beside it. A
counter drifts from the rows it summarizes and reconciling it is work that never ends; aggregating
the source of truth means the dashboard cannot disagree with the history on the next screen.
Latency percentiles cover attempts the destination _answered_ — folding a ten-second timeout into
the distribution would measure how long Hookline waited, not how fast the destination is.

Live updates travel over PostgreSQL `LISTEN`/`NOTIFY` into an SSE endpoint. An in-process emitter
would be wrong the moment there is a second API instance: a console attached to one would never see
work dispatched by the other.

## The console

A Next.js App Router application that reads the API **server-side**. The tenant API key lives in an
HttpOnly cookie and is attached by server components, server actions and route handlers, so the
credential is unreachable from client JavaScript and the API needs no public CORS surface. There is
no separate user store: the API already owns credentials with scopes, and inventing console
accounts on top would mean two things to keep in sync and two places to revoke.

`EventSource` cannot set an `Authorization` header, so the live feed goes through a route handler
that attaches the key and pipes the upstream stream through.

## The test receiver

Deliberately framework-free, in its own process, with the control plane on a **separate port** —
because going offline means the sink stops listening, and a control API sharing that listener would
become unreachable exactly when it is needed to end the outage. It verifies signatures with the
same package the sender signs with, so the contract is exercised by an independent process rather
than asserted by the component that produced it.
