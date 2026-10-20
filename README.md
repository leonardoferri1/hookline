# Hookline

**Seu evento chega ao destino.** A local-first webhook delivery platform: applications publish
events, Hookline signs them, delivers them to customer endpoints, retries what fails, and keeps a
searchable history with manual replay.

![The Hookline console](docs/images/overview.jpg)

The interesting part of a webhook product is not the happy path. It is what happens when a
customer's endpoint goes down at 3am, answers in nine seconds, rejects a signature after a botched
rotation, or comes back and expects everything it missed. Hookline is built around that, and ships
with a receiver you can break on purpose to watch it happen.

## Run locally

Requirements: **Node.js 22+**, npm, and a desktop OS. Tested on Windows x64 with Node 26 and
PostgreSQL 18.4. No Docker, cloud account, or API key is needed.

```sh
npm ci
npm run dev
```

- Console: http://127.0.0.1:4310
- API documentation: http://127.0.0.1:3021/api/docs
- API health: http://127.0.0.1:3021/api/health

`npm run dev` starts a real PostgreSQL server through the `embedded-postgres` development package,
applies versioned SQL migrations, seeds a fictional tenant with two destinations, boots the test
receiver and the console, and pre-fills the sign-in screen with the demonstration key. Data
persists in the ignored `.local/postgres`. Everything binds loopback; nothing is deployed. Stop
with Ctrl+C.

The first install downloads PostgreSQL binaries, so installation scripts must be enabled. Ports
4310, 3021, 3022, 3023 and 55441 must be free. PostgreSQL refuses to run as root; use a normal user
or the external-database path below.

### Bring your own PostgreSQL

```sh
docker compose up -d
```

Set `DATABASE_URL=postgresql://hookline:hookline-local-only@127.0.0.1:55441/hookline` and run
`npm run dev`. In PowerShell: `$env:DATABASE_URL = '…'`. Use a dedicated development database: the
runner applies migrations and inserts demonstration data.

## The demonstration worth watching

Open **Failure drill** in the console.

1. Publish eight events. They deliver, and the receiver reports every signature as valid.
2. Set the receiver to **offline** and publish eight more. It stops listening, so attempts record
   `connection_refused` rather than an error response, and the retry delay grows between attempts.
3. After five consecutive failures the **circuit breaker opens**. Nothing more is sent to that
   destination; queued work waits rather than being dropped.
4. When the cooldown elapses, exactly **one probe** is allowed through, not the backlog. It fails,
   the breaker re-opens, and the cooldown doubles.
5. Set the receiver back to **ok**. The next probe succeeds, the breaker closes, and the backlog
   drains.
6. Anything that spent its retry budget is re-queued from the deliveries screen, which creates new
   deliveries pointing at the originals rather than erasing what happened.

![The failure drill mid-outage](docs/images/failure-drill.jpg)

## What it does

- Publish events over HTTP with per-tenant API keys, scopes and an ingest quota.
- Fan each event out to every endpoint whose subscription matches, in the same transaction.
- Sign every request with a versioned, timestamped HMAC, with overlapping secrets during rotation.
- Retry with exponential backoff and jitter, honouring a destination's `Retry-After`.
- Deliver one partition key at a time for endpoints that ask for ordering.
- Open a circuit breaker on a failing destination and recover it with a single probe.
- Keep every attempt, with the signature header sent and the response received.
- Replay one delivery or an endpoint's whole exhausted backlog, oldest first.
- Report volume, error rate and latency percentiles, aggregated from the attempt log.
- Stream activity to the console over SSE carried by PostgreSQL `LISTEN`/`NOTIFY`.

## Engineering decisions

| Concern              | Implementation                                            | Why                                                                                        |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Losing an event      | Event and deliveries commit in one transaction            | A 202 means the work is durable, not that it was sent                                      |
| Duplicate publishes  | Advisory lock per tenant and key, canonical fingerprint   | Concurrent retries converge; a reused key with different content is reported, not absorbed |
| Parallel dispatchers | `FOR UPDATE … SKIP LOCKED` with leases                    | Workers take disjoint work; one slow destination never stalls the queue                    |
| A crashed dispatcher | Lease expiry sweep; the attempt is already counted        | Work returns to the queue without becoming retryable forever                               |
| A dead destination   | Circuit breaker with a single half-open probe             | The queue is not spent on requests that cannot succeed                                     |
| A recovering one     | Equal-jitter backoff; `Retry-After` wins when sent        | Everything queued is due at once; jitter stops the recovery spike                          |
| Ordering             | Per-partition claim guard                                 | Sequence where it matters, confined to one key                                             |
| Request forgery      | Address policy plus a pinned DNS lookup, no redirects     | The destination URL is attacker-chosen; a check without pinning is a rebinding hole        |
| Consumer trust       | Timestamped HMAC over the raw body, constant-time compare | Tamper and replay are both detectable; secrets overlap during rotation                     |
| Metrics              | Aggregated from `delivery_attempts` on read               | A counter drifts from the rows it summarizes; this cannot disagree with the history        |
| Live updates         | SSE over `LISTEN`/`NOTIFY`                                | An in-process emitter breaks as soon as there are two API instances                        |

More detail in [`docs/architecture.md`](docs/architecture.md).

## Layout

```
apps/api            NestJS delivery API and dispatcher
apps/receiver       Controllable test receiver (no framework, on purpose)
apps/web            Next.js console; reads the API server-side
packages/signature  The signature scheme, shared by sender and consumers
```

The API is organized by module, each with `domain` (entities and repository ports), `application`
(use cases), `infrastructure` (PostgreSQL and HTTP), and `api` (controllers and DTOs). Ports are
abstract classes so they double as injection tokens and the application layer never imports `pg`.

## Verification

```sh
npm test          # 58 tests: unit suites plus integration against a real PostgreSQL cluster
npm run test:unit # the pure ones only, no database required
npm run build     # every workspace, including a production build of the console
npm run format:check
```

The integration suite starts a throwaway PostgreSQL cluster and a real HTTP receiver, then drives
the dispatcher explicitly so nothing depends on timer timing. See
[`docs/verification.md`](docs/verification.md) for what each test proves.

## Limits

These are stated because a portfolio project that hides them is less useful than one that does not.

- **Not deployed.** Everything runs on loopback. There is no hosted environment, no TLS termination
  and no multi-node deployment to point at.
- **Signing secrets are stored in plaintext**, because HMAC signing needs the original value. A
  hosted deployment belongs behind envelope encryption with a managed key.
- **Metrics read every attempt in the window.** Correct at this volume; a deployment doing millions
  a day would roll the same expressions into per-minute aggregates.
- **No retention policy.** Attempts and payloads accumulate; see the roadmap.
- **Delivery is at-least-once.** Consumers must deduplicate on `Hookline-Event-Id`, which is why
  the request body is byte-identical across attempts and replays.
- **Timings shown in the console describe this local run.** They are not throughput claims.

Next steps are in [`docs/roadmap.md`](docs/roadmap.md).
