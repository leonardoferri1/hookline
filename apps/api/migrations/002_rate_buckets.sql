-- Ingest quota per tenant, stored as a token bucket.
--
-- Only the token count and the moment it was last touched are persisted; tokens are restored
-- lazily from elapsed time when the bucket is read, which costs one row per tenant instead of one
-- row per request. The bucket lives in the database rather than in process memory so the limit
-- holds across API instances and restarts.
CREATE TABLE rate_buckets (
  tenant_id uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  tokens double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rate_buckets_tokens_not_negative CHECK (tokens >= 0)
);
