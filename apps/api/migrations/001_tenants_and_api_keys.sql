-- Tenants are the unit of isolation and of quota. Every other table hangs off a tenant, and every
-- query in the application filters by it.
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  -- Ingest quota, expressed as a token bucket: `rate` tokens are restored per minute and at most
  -- `burst` tokens may accumulate.
  ingest_rate_per_minute integer NOT NULL DEFAULT 120,
  ingest_burst integer NOT NULL DEFAULT 60,
  max_endpoints integer NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  CONSTRAINT tenants_name_present CHECK (btrim(name) <> ''),
  CONSTRAINT tenants_rate_positive CHECK (ingest_rate_per_minute > 0),
  CONSTRAINT tenants_burst_positive CHECK (ingest_burst > 0),
  CONSTRAINT tenants_max_endpoints_positive CHECK (max_endpoints > 0)
);

CREATE UNIQUE INDEX tenants_slug_key ON tenants (slug);

-- API keys are presented as `hk_<mode>_<public_id>_<secret>`. Only the public id is stored in the
-- clear: it indexes the row so authentication is a single primary-key lookup, while the secret is
-- kept as a SHA-256 digest and compared in constant time. The plaintext key is unrecoverable once
-- issued, which is the behaviour an operator should expect from a credential store.
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  public_id text NOT NULL,
  secret_hash text NOT NULL,
  scopes text[] NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_name_present CHECK (btrim(name) <> ''),
  CONSTRAINT api_keys_scopes_present CHECK (cardinality(scopes) > 0),
  CONSTRAINT api_keys_scopes_known CHECK (
    scopes <@ ARRAY['events:write', 'endpoints:read', 'endpoints:write', 'deliveries:read', 'deliveries:replay']::text[]
  )
);

CREATE UNIQUE INDEX api_keys_public_id_key ON api_keys (public_id);
CREATE INDEX api_keys_tenant_idx ON api_keys (tenant_id) WHERE revoked_at IS NULL;
