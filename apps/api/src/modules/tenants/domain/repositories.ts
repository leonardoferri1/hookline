import { Queryable } from '../../../shared/database/database.service';
import { ApiKey } from './api-key';
import { Scope } from './scope';
import { Tenant, TenantLimits } from './tenant';

export interface CreateTenantInput {
  readonly slug: string;
  readonly name: string;
  readonly limits?: Partial<TenantLimits>;
}

export interface CreateApiKeyInput {
  readonly tenantId: string;
  readonly name: string;
  readonly publicId: string;
  readonly secretHash: string;
  readonly scopes: readonly Scope[];
}

/**
 * Repository ports are declared as abstract classes so they double as injection tokens: the
 * application layer depends on the contract, while PostgreSQL stays an implementation detail that
 * can be swapped in tests or replaced wholesale.
 */
export abstract class TenantRepository {
  abstract findById(id: string, client?: Queryable): Promise<Tenant | null>;
  abstract findBySlug(slug: string, client?: Queryable): Promise<Tenant | null>;
  abstract create(input: CreateTenantInput, client?: Queryable): Promise<Tenant>;
}

export abstract class ApiKeyRepository {
  abstract findByPublicId(publicId: string, client?: Queryable): Promise<ApiKey | null>;
  abstract listByTenant(tenantId: string, client?: Queryable): Promise<ApiKey[]>;
  abstract create(input: CreateApiKeyInput, client?: Queryable): Promise<ApiKey>;
  abstract touchLastUsed(id: string, usedAt: Date, client?: Queryable): Promise<void>;
  abstract revoke(
    id: string,
    tenantId: string,
    revokedAt: Date,
    client?: Queryable,
  ): Promise<boolean>;
}
