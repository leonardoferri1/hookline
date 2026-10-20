export type EndpointStatus = 'enabled' | 'paused';
export type CircuitState = 'closed' | 'open' | 'half_open';

export interface EndpointHealth {
  readonly circuitState: CircuitState;
  readonly consecutiveFailures: number;
  readonly circuitOpenedAt: Date | null;
  readonly circuitRetryAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly lastFailureAt: Date | null;
}

export interface Endpoint {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly url: string;
  readonly description: string | null;
  readonly status: EndpointStatus;
  readonly eventTypes: readonly string[];
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  /** When true, deliveries that share a partition key are sent one at a time, in ingest order. */
  readonly ordered: boolean;
  readonly health: EndpointHealth;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EndpointSecret {
  readonly id: string;
  readonly endpointId: string;
  readonly secret: string;
  readonly createdAt: Date;
  /** Null while the secret is the only active one; set to the end of a rotation overlap. */
  readonly expiresAt: Date | null;
}

/** An endpoint accepts traffic only while it is enabled and its breaker is not open. */
export function acceptsDeliveries(endpoint: Endpoint, now: Date): boolean {
  if (endpoint.status !== 'enabled') return false;
  if (endpoint.health.circuitState !== 'open') return true;
  return endpoint.health.circuitRetryAt !== null && endpoint.health.circuitRetryAt <= now;
}

export function activeSecrets(secrets: readonly EndpointSecret[], now: Date): string[] {
  return secrets
    .filter((candidate) => candidate.expiresAt === null || candidate.expiresAt > now)
    .map((candidate) => candidate.secret);
}
