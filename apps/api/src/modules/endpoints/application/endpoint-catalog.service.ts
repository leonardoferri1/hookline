import { Injectable } from '@nestjs/common';
import { generateSigningSecret } from '@hookline/signature';
import { Clock } from '../../../shared/clock/clock';
import { Database } from '../../../shared/database/database.service';
import { ConflictError, NotFoundError } from '../../../shared/errors/domain-error';
import { Endpoint, EndpointSecret, activeSecrets } from '../domain/endpoint';
import { normalizeDestinationUrl } from '../domain/destination-url';
import { assertSubscriptionPatterns } from '../domain/event-type';
import {
  EndpointRepository,
  EndpointSecretRepository,
  UpdateEndpointInput,
} from '../domain/repositories';
import { TenantLimits } from '../../tenants/domain/tenant';

export interface CreateEndpointCommand {
  readonly tenantId: string;
  readonly limits: TenantLimits;
  readonly name: string;
  readonly url: string;
  readonly description?: string | null;
  readonly eventTypes: readonly string[];
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly ordered?: boolean;
}

export interface UpdateEndpointCommand extends UpdateEndpointInput {
  readonly tenantId: string;
  readonly endpointId: string;
}

export interface EndpointWithSecret {
  readonly endpoint: Endpoint;
  /** Returned once at creation and once per rotation, so the operator can configure the consumer. */
  readonly secret: string;
}

/** How long a replaced secret keeps signing alongside its successor. */
export const DEFAULT_ROTATION_GRACE_SECONDS = 24 * 60 * 60;
export const MAX_ROTATION_GRACE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Owns the endpoint lifecycle. Creation and rotation are transactional because an endpoint without
 * a signing secret, or a rotation that produced a secret but failed to narrow the previous one,
 * would both leave an operator guessing which secret is in force.
 */
@Injectable()
export class EndpointCatalog {
  constructor(
    private readonly database: Database,
    private readonly endpoints: EndpointRepository,
    private readonly secrets: EndpointSecretRepository,
    private readonly clock: Clock,
  ) {}

  async create(command: CreateEndpointCommand): Promise<EndpointWithSecret> {
    assertSubscriptionPatterns(command.eventTypes);
    const url = normalizeDestinationUrl(command.url);

    return this.database.transaction(async (client) => {
      const existing = await this.endpoints.countByTenant(command.tenantId, client);
      if (existing >= command.limits.maxEndpoints)
        throw new ConflictError(
          `This tenant may configure at most ${command.limits.maxEndpoints} endpoints.`,
          'endpoint_limit_reached',
          { maxEndpoints: command.limits.maxEndpoints },
        );

      const endpoint = await this.endpoints
        .create(
          {
            tenantId: command.tenantId,
            name: command.name.trim(),
            url,
            description: command.description?.trim() || null,
            eventTypes: [...new Set(command.eventTypes)],
            maxAttempts: command.maxAttempts ?? 6,
            timeoutMs: command.timeoutMs ?? 10_000,
            ordered: command.ordered ?? false,
          },
          client,
        )
        .catch((error: unknown) => {
          throw translateUniqueViolation(error, command.name);
        });

      const secret = generateSigningSecret();
      await this.secrets.add(endpoint.id, secret, client);
      return { endpoint, secret };
    });
  }

  async list(tenantId: string): Promise<Endpoint[]> {
    return this.endpoints.listByTenant(tenantId);
  }

  async get(tenantId: string, endpointId: string): Promise<Endpoint> {
    const endpoint = await this.endpoints.findById(tenantId, endpointId);
    if (!endpoint) throw new NotFoundError('Endpoint', endpointId);
    return endpoint;
  }

  async update(command: UpdateEndpointCommand): Promise<Endpoint> {
    if (command.eventTypes) assertSubscriptionPatterns(command.eventTypes);
    const updated = await this.endpoints
      .update(command.tenantId, command.endpointId, {
        ...command,
        name: command.name?.trim(),
        url: command.url ? normalizeDestinationUrl(command.url) : undefined,
        eventTypes: command.eventTypes ? [...new Set(command.eventTypes)] : undefined,
      })
      .catch((error: unknown) => {
        throw translateUniqueViolation(error, command.name ?? '');
      });
    if (!updated) throw new NotFoundError('Endpoint', command.endpointId);
    return updated;
  }

  async delete(tenantId: string, endpointId: string): Promise<void> {
    const deleted = await this.endpoints.delete(tenantId, endpointId);
    if (!deleted) throw new NotFoundError('Endpoint', endpointId);
  }

  async listSecrets(tenantId: string, endpointId: string): Promise<EndpointSecret[]> {
    await this.get(tenantId, endpointId);
    return this.secrets.listByEndpoint(endpointId);
  }

  /**
   * Issues a new signing secret and schedules the end of the previous one. During the overlap the
   * sender signs with both, which is what lets a consumer deploy the new secret without dropping
   * requests that are already in flight.
   */
  async rotateSecret(
    tenantId: string,
    endpointId: string,
    graceSeconds = DEFAULT_ROTATION_GRACE_SECONDS,
  ): Promise<EndpointWithSecret> {
    const grace = Math.min(Math.max(graceSeconds, 0), MAX_ROTATION_GRACE_SECONDS);
    return this.database.transaction(async (client) => {
      const endpoint = await this.endpoints.findById(tenantId, endpointId, client);
      if (!endpoint) throw new NotFoundError('Endpoint', endpointId);
      const secret = generateSigningSecret();
      const created = await this.secrets.add(endpoint.id, secret, client);
      const expiresAt = new Date(this.clock.now().getTime() + grace * 1000);
      await this.secrets.expireOthers(endpoint.id, created.id, expiresAt, client);
      return { endpoint, secret };
    });
  }

  /** Secrets the sender must sign with right now, newest first. */
  async signingSecrets(endpointId: string): Promise<string[]> {
    const stored = await this.secrets.listByEndpoint(endpointId);
    return activeSecrets(stored, this.clock.now());
  }
}

const UNIQUE_VIOLATION = '23505';

/**
 * Endpoint names are unique per tenant. The race between checking and inserting is left to the
 * database, and the constraint violation is translated here into the same conflict a pre-check
 * would have produced.
 */
function translateUniqueViolation(error: unknown, name: string): unknown {
  const code = (error as { code?: string } | null)?.code;
  if (code !== UNIQUE_VIOLATION) return error;
  return new ConflictError(
    `An endpoint named "${name.trim()}" already exists for this tenant.`,
    'endpoint_name_taken',
    { name: name.trim() },
  );
}
