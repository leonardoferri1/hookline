# Verification

```sh
npm test          # everything: 58 tests
npm run test:unit # the pure suites only, no database
npm run build     # every workspace, including a production build of the console
npm run format:check
```

`npm test` starts a throwaway PostgreSQL cluster on port 55442, runs the suite against it, then
stops and deletes it. CI uses `npm run test:external` with its own PostgreSQL service.

## What the integration suite proves

It runs against a real database and a real HTTP receiver in a separate listener. That is a choice,
not a convenience: disjoint claims under `SKIP LOCKED`, lease recovery after a crash, a refused
connection classified apart from a status code, and a signature verified by an independent process
are precisely the behaviours a mock would assume rather than prove.

The dispatcher's background loop is disabled and cycles are driven explicitly, with the retry
schedule advanced through SQL, so no assertion depends on how fast a timer happens to fire.

| Test                                                    | What it establishes                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| delivers a signed request the destination can verify    | The receiver verifies the signature over the bytes it received                   |
| fans an event out only to subscribed endpoints          | `order.*` and `*` match `order.refunded`; `invoice.paid` does not                |
| returns the original event when a key is replayed       | Reordered JSON keys are the same event, via the canonical fingerprint            |
| refuses a key reused with a different body              | `409 idempotency_key_reuse` instead of silently absorbing it                     |
| deduplicates concurrent publishes sharing a key         | Eight parallel publishes produce exactly one event and one delivery              |
| retries and gives up when the budget is spent           | Three attempts recorded, then `failed`; the attempt log shows all three          |
| schedules the next attempt in the future                | A backing-off delivery is not claimed by a cycle that does not advance the clock |
| records a refused connection as a transport error       | `connection_refused` with no status code, distinct from a 5xx                    |
| honours Retry-After over its own backoff                | A 120s header beats a backoff that would have been at most 5s                    |
| opens the breaker, probes once, and recovers            | Eight failures open it; the cooldown admits one probe, not the backlog; a        |
|                                                         | successful probe closes it and all eight deliveries then succeed                 |
| sends nothing to a paused endpoint, resumes on enable   | Pausing queues rather than unsubscribes                                          |
| delivers one partition key at a time, in order          | Four events with one key arrive 1, 2, 3, 4 — one per cycle                       |
| lets an unordered endpoint send a partition in parallel | Ordering is opt-in per endpoint                                                  |
| never hands the same delivery to two dispatchers        | Two racing cycles split ten deliveries; no attempt number is duplicated          |
| returns a delivery to the queue when its lease expires  | The sweep recovers it, and the crashed attempt still counts against the budget   |
| replays a failed delivery as a new one                  | The original stays `failed`; the replay points at it and succeeds                |
| exposes the attempt log with the signature, no secret   | The header as sent is stored; the secret never appears                           |
| cancels a pending delivery but not a settled one        | `409 delivery_not_cancelable` on the second attempt                              |
| keeps one tenant out of another's deliveries            | `404`, not `403`: the resource does not exist for that tenant                    |
| enforces the scopes declared on each route              | A publisher key is refused on endpoint and delivery reads                        |
| refuses ingest beyond the burst                         | `202, 202, 202, 429, 429` with `Retry-After`                                     |
| refuses an undeliverable destination URL                | `422` before any address is resolved                                             |
| summarizes attempts, errors and latency                 | Three attempts, one success, error rate 2/3, one exhausted delivery              |

## What the unit suites cover

- **Signature scheme** — rotation overlap, tampered payloads, replays outside tolerance, a
  signature moved to another timestamp, malformed headers reported by reason.
- **Backoff** — the exponential floor, the jitter window, the ceiling, and `Retry-After` parsing in
  both seconds and HTTP-date form, including a hostile value.
- **Circuit breaker policy** — the threshold, the doubling cooldown, the cap, and immediate
  re-opening when a probe fails.
- **Subscription matching** — the three pattern forms, and that `order.*` does not match
  `orders.paid`.
- **Address policy** — loopback, private, link-local (including `169.254.169.254`), carrier-grade
  NAT, multicast and reserved ranges, in IPv4 and IPv6, including IPv4-mapped forms.
- **Quota arithmetic** — the wait reported on a refusal, never rounded down to zero.
- **Metrics windows** — bucket sizing and the error rate of an idle window.

## Honest limits of the suite

- Concurrency is exercised with two dispatcher cycles in one process. It proves the claim query
  hands out disjoint work; it does not prove behaviour across machines with clock skew.
- The receiver runs on loopback, so transport timings are not network-realistic.
- There is no load test. Nothing here is a throughput claim.
