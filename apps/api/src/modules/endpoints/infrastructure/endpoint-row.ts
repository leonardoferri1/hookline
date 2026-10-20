import { Endpoint, EndpointSecret, EndpointStatus, CircuitState } from '../domain/endpoint';

export interface EndpointRow {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  description: string | null;
  status: EndpointStatus;
  event_types: string[];
  max_attempts: number;
  timeout_ms: number;
  ordered: boolean;
  circuit_state: CircuitState;
  consecutive_failures: number;
  circuit_opened_at: Date | null;
  circuit_retry_at: Date | null;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface EndpointSecretRow {
  id: string;
  endpoint_id: string;
  secret: string;
  created_at: Date;
  expires_at: Date | null;
}

export const ENDPOINT_COLUMNS = `id, tenant_id, name, url, description, status, event_types,
  max_attempts, timeout_ms, ordered, circuit_state, consecutive_failures, circuit_opened_at,
  circuit_retry_at, last_success_at, last_failure_at, created_at, updated_at`;

export function toEndpoint(row: EndpointRow): Endpoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    url: row.url,
    description: row.description,
    status: row.status,
    eventTypes: row.event_types,
    maxAttempts: row.max_attempts,
    timeoutMs: row.timeout_ms,
    ordered: row.ordered,
    health: {
      circuitState: row.circuit_state,
      consecutiveFailures: row.consecutive_failures,
      circuitOpenedAt: row.circuit_opened_at,
      circuitRetryAt: row.circuit_retry_at,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEndpointSecret(row: EndpointSecretRow): EndpointSecret {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    secret: row.secret,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
