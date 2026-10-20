import { ApiKey } from '../domain/api-key';
import { Scope } from '../domain/scope';
import { Tenant } from '../domain/tenant';

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  ingest_rate_per_minute: number;
  ingest_burst: number;
  max_endpoints: number;
  created_at: Date;
}

export interface ApiKeyRow {
  id: string;
  tenant_id: string;
  name: string;
  public_id: string;
  secret_hash: string;
  scopes: string[];
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    limits: {
      ingestRatePerMinute: row.ingest_rate_per_minute,
      ingestBurst: row.ingest_burst,
      maxEndpoints: row.max_endpoints,
    },
    createdAt: row.created_at,
  };
}

export function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    publicId: row.public_id,
    secretHash: row.secret_hash,
    scopes: row.scopes as Scope[],
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}
