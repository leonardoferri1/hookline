import { Queryable } from '../../../shared/database/database.service';
import { Endpoint, EndpointSecret, EndpointStatus } from './endpoint';

export interface CreateEndpointInput {
  readonly tenantId: string;
  readonly name: string;
  readonly url: string;
  readonly description: string | null;
  readonly eventTypes: readonly string[];
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly ordered: boolean;
}

export interface UpdateEndpointInput {
  readonly name?: string;
  readonly url?: string;
  readonly description?: string | null;
  readonly eventTypes?: readonly string[];
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly ordered?: boolean;
  readonly status?: EndpointStatus;
}

export abstract class EndpointRepository {
  abstract findById(tenantId: string, id: string, client?: Queryable): Promise<Endpoint | null>;
  abstract listByTenant(tenantId: string, client?: Queryable): Promise<Endpoint[]>;
  abstract countByTenant(tenantId: string, client?: Queryable): Promise<number>;
  /** Endpoints of this tenant whose subscriptions match `eventType`, in a single query. */
  abstract findSubscribers(
    tenantId: string,
    eventType: string,
    client?: Queryable,
  ): Promise<Endpoint[]>;
  abstract create(input: CreateEndpointInput, client?: Queryable): Promise<Endpoint>;
  abstract update(
    tenantId: string,
    id: string,
    input: UpdateEndpointInput,
    client?: Queryable,
  ): Promise<Endpoint | null>;
  abstract delete(tenantId: string, id: string, client?: Queryable): Promise<boolean>;
}

export abstract class EndpointSecretRepository {
  abstract listByEndpoint(endpointId: string, client?: Queryable): Promise<EndpointSecret[]>;
  abstract add(endpointId: string, secret: string, client?: Queryable): Promise<EndpointSecret>;
  /** Closes the rotation window on every other active secret of the endpoint. */
  abstract expireOthers(
    endpointId: string,
    keepSecretId: string,
    expiresAt: Date,
    client?: Queryable,
  ): Promise<void>;
}
