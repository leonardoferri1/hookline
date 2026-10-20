CREATE TYPE endpoint_status AS ENUM ('enabled', 'paused');

-- Delivery health per destination, used to stop hammering an endpoint that is clearly down.
CREATE TYPE circuit_state AS ENUM ('closed', 'open', 'half_open');

CREATE TABLE endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  description text,
  status endpoint_status NOT NULL DEFAULT 'enabled',
  -- Subscription patterns: an exact event type, `prefix.*`, or `*` for every event.
  event_types text[] NOT NULL,
  max_attempts integer NOT NULL DEFAULT 6,
  timeout_ms integer NOT NULL DEFAULT 10000,
  -- When true, deliveries sharing a partition key are sent one at a time, in ingest order.
  ordered boolean NOT NULL DEFAULT false,
  circuit_state circuit_state NOT NULL DEFAULT 'closed',
  consecutive_failures integer NOT NULL DEFAULT 0,
  circuit_opened_at timestamptz,
  -- When the breaker is open, the moment a single probe delivery may be attempted.
  circuit_retry_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT endpoints_name_present CHECK (btrim(name) <> ''),
  CONSTRAINT endpoints_url_scheme CHECK (url ~ '^https?://'),
  CONSTRAINT endpoints_event_types_present CHECK (cardinality(event_types) > 0),
  CONSTRAINT endpoints_event_types_not_blank CHECK (NOT ('' = ANY (event_types))),
  CONSTRAINT endpoints_max_attempts_range CHECK (max_attempts BETWEEN 1 AND 20),
  CONSTRAINT endpoints_timeout_range CHECK (timeout_ms BETWEEN 500 AND 30000),
  CONSTRAINT endpoints_failures_not_negative CHECK (consecutive_failures >= 0)
);

CREATE UNIQUE INDEX endpoints_tenant_name_key ON endpoints (tenant_id, lower(name));
CREATE INDEX endpoints_tenant_idx ON endpoints (tenant_id, created_at DESC);

-- Signing secrets. Several rows may be active at once so a consumer can adopt a new secret before
-- the previous one is retired; `expires_at` marks the end of that overlap.
--
-- The secret is stored in the clear because HMAC signing needs the original value and the
-- consumer holds the same string. In a hosted deployment this column belongs in an encrypted
-- tablespace or behind envelope encryption with a managed key; see docs/roadmap.md.
CREATE TABLE endpoint_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES endpoints (id) ON DELETE CASCADE,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT endpoint_secrets_secret_present CHECK (length(secret) >= 16)
);

CREATE INDEX endpoint_secrets_endpoint_idx ON endpoint_secrets (endpoint_id, created_at DESC);
