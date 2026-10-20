CREATE TYPE attempt_outcome AS ENUM (
  'succeeded',        -- the destination answered 2xx
  'rejected',         -- the destination answered, but not with 2xx
  'transport_error'   -- no usable answer: timeout, refused connection, TLS, DNS, blocked address
);

-- One row per attempt, kept even after the delivery succeeds. This is the evidence an operator
-- needs when a customer asks why a webhook arrived late, twice, or not at all, and it is also the
-- only source for the latency and error metrics.
CREATE TABLE delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES endpoints (id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  outcome attempt_outcome NOT NULL,
  status_code integer,
  error_reason text,
  error_message text,
  duration_ms integer NOT NULL,
  -- The signature header as sent, so a consumer dispute can be settled without re-signing.
  -- Never the signing secret itself.
  request_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_body text,
  response_truncated boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_attempts_number_positive CHECK (attempt_number >= 1),
  CONSTRAINT delivery_attempts_duration_not_negative CHECK (duration_ms >= 0),
  CONSTRAINT delivery_attempts_status_present_when_answered CHECK (
    (outcome = 'transport_error') = (status_code IS NULL)
  )
);

-- Replaying the same attempt number twice would mean a lease was honoured twice.
CREATE UNIQUE INDEX delivery_attempts_delivery_number_key
  ON delivery_attempts (delivery_id, attempt_number);

-- Metrics windows scan by time, per tenant and per endpoint.
CREATE INDEX delivery_attempts_tenant_started_idx ON delivery_attempts (tenant_id, started_at DESC);
CREATE INDEX delivery_attempts_endpoint_started_idx
  ON delivery_attempts (endpoint_id, started_at DESC);
CREATE INDEX delivery_attempts_delivery_idx ON delivery_attempts (delivery_id, attempt_number);
