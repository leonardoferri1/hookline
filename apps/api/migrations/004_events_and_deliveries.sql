-- An event is what the publisher asserts happened. It is stored once and never rewritten: the
-- delivery rows that fan out from it carry all mutable state.
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  -- Events sharing a partition key are delivered in order to endpoints that ask for ordering.
  partition_key text,
  idempotency_key text,
  -- Digest of type, payload and partition key, used to detect a reused idempotency key that
  -- carries different content - almost always a client bug worth reporting rather than absorbing.
  payload_fingerprint text NOT NULL,
  source text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_type_format CHECK (type ~ '^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$'),
  CONSTRAINT events_partition_key_length CHECK (partition_key IS NULL OR length(partition_key) BETWEEN 1 AND 200),
  CONSTRAINT events_idempotency_key_length CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 200)
);

-- Idempotency is scoped to the tenant: two customers may use the same key without colliding.
CREATE UNIQUE INDEX events_tenant_idempotency_key
  ON events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX events_tenant_created_idx ON events (tenant_id, created_at DESC);
CREATE INDEX events_tenant_type_idx ON events (tenant_id, type, created_at DESC);

CREATE TYPE delivery_state AS ENUM (
  'pending',    -- waiting for its next attempt
  'in_flight',  -- claimed by a dispatcher and leased
  'succeeded',  -- the destination answered 2xx
  'failed',     -- the retry budget is exhausted
  'canceled'    -- withdrawn by an operator
);

-- One row per (event, endpoint) pair: the unit of work the dispatcher claims, and the record an
-- operator inspects or replays.
CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES endpoints (id) ON DELETE CASCADE,
  state delivery_state NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  -- Copied from the endpoint at fan-out time so changing the endpoint later does not retroactively
  -- extend or cut the budget of deliveries already queued.
  max_attempts integer NOT NULL,
  partition_key text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  leased_by text,
  last_status_code integer,
  last_error text,
  first_attempt_at timestamptz,
  completed_at timestamptz,
  -- Set when this delivery was created by replaying another one.
  replay_of uuid REFERENCES deliveries (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deliveries_attempts_within_budget CHECK (attempt_count <= max_attempts),
  CONSTRAINT deliveries_lease_consistent CHECK ((leased_until IS NULL) = (leased_by IS NULL))
);

-- The dispatcher's claim query: due work only, so the index stays proportional to the backlog
-- rather than to the delivery history.
CREATE INDEX deliveries_due_idx ON deliveries (next_attempt_at, created_at)
  WHERE state = 'pending';

-- Supports the ordering rule: find whether a partition already has a delivery in flight.
CREATE INDEX deliveries_partition_in_flight_idx ON deliveries (endpoint_id, partition_key)
  WHERE state = 'in_flight';

-- Lets a dispatcher recover deliveries whose lease expired after a crash.
CREATE INDEX deliveries_expired_lease_idx ON deliveries (leased_until) WHERE state = 'in_flight';

CREATE INDEX deliveries_tenant_created_idx ON deliveries (tenant_id, created_at DESC);
CREATE INDEX deliveries_endpoint_created_idx ON deliveries (endpoint_id, created_at DESC);
CREATE INDEX deliveries_event_idx ON deliveries (event_id);
