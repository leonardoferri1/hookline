# Roadmap

What is deliberately missing, and what each item would take. Ordered by how much it would change
the product rather than by effort.

## Operational gaps

- **Retention and archival.** Attempts and payloads accumulate forever. A per-tenant retention
  window, with payloads moved to object storage and attempt bodies truncated earlier, is the first
  thing a hosted deployment needs.
- **Secret encryption at rest.** Signing secrets are stored in plaintext because HMAC needs the
  original value. Envelope encryption with a managed key, decrypting only in the dispatcher, is the
  shape of the fix.
- **Dead letter handling.** A delivery that exhausts its budget stays `failed` and waits for a
  human. Routing exhausted deliveries into a per-endpoint dead-letter view with bulk actions, and
  telling the tenant about it, would close the loop.
- **Per-endpoint concurrency and pacing.** The dispatcher bounds work per cycle, not per
  destination, so a slow endpoint can still occupy a disproportionate share of a batch.

## Correctness and scale

- **Pre-aggregated metrics.** The current queries read every attempt in the window. Rolling them
  into per-minute aggregates, written as attempts land, keeps the same query shape at a thousand
  times the volume.
- **Partitioned attempt history.** `delivery_attempts` is the table that grows without bound.
  Monthly partitions make retention a `DROP` rather than a long `DELETE`.
- **Clock skew between dispatchers.** Leases and backoff use each process's own clock. Deriving
  both from the database would remove the assumption.
- **Payload deduplication.** A payload fanned out to many endpoints is stored once per event, which
  is fine; large payloads repeated across events are not deduplicated at all.

## Product

- **Endpoint-side observability for customers.** A tenant can see its own deliveries, but the
  customer operating the destination cannot. A scoped, read-only view per endpoint is a small
  addition and a genuinely useful one.
- **Transformations and filtering.** Per-endpoint payload shaping and predicates beyond event type,
  so a destination can subscribe to "orders above R$ 1.000" without receiving the rest.
- **Alerting.** The breaker already knows when a destination has been down for a while, and nothing
  tells anyone. Email, or a webhook about webhooks.
- **Event-level replay.** Replay works on deliveries. Replaying an _event_ to a newly registered
  endpoint — backfilling a destination added after the fact — is a different operation.

## Platform

- **Deployment.** Nothing is hosted. A deployment needs TLS termination, a managed PostgreSQL
  instance, dispatcher processes separate from the API, and the address policy switched back to
  refusing private destinations.
- **Horizontal dispatchers.** The claim query already supports several workers; running them as
  separate processes with their own scaling is a configuration change plus proof under real load.
- **OpenTelemetry.** Structured logs carry a request id today. Spans across ingest, dispatch and
  the destination would make a slow delivery explainable rather than merely visible.
