import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../../shared/errors/domain-error';
import { Database } from '../../../shared/database/database.service';
import { apiKeyToken } from '../domain/api-key';
import { ApiKeyRepository, TenantRepository } from '../domain/repositories';
import { Scope } from '../domain/scope';
import { Tenant, TenantLimits } from '../domain/tenant';

export interface ProvisionTenantInput {
  readonly slug: string;
  readonly name: string;
  readonly limits?: Partial<TenantLimits>;
  readonly keys: ReadonlyArray<{ name: string; scopes: readonly Scope[] }>;
}

export interface ProvisionedTenant {
  readonly tenant: Tenant;
  /** Plaintext tokens, available only here because they are not stored. */
  readonly tokens: ReadonlyArray<{ name: string; token: string; scopes: readonly Scope[] }>;
}

/**
 * Creates a tenant together with its initial keys in one transaction: a tenant that exists but has
 * no usable credential is not a state an operator should have to repair by hand.
 */
@Injectable()
export class ProvisionTenant {
  constructor(
    private readonly database: Database,
    private readonly tenants: TenantRepository,
    private readonly apiKeys: ApiKeyRepository,
  ) {}

  async execute(input: ProvisionTenantInput): Promise<ProvisionedTenant> {
    return this.database.transaction(async (client) => {
      const existing = await this.tenants.findBySlug(input.slug, client);
      if (existing)
        throw new ConflictError(`Tenant ${input.slug} already exists.`, 'tenant_exists');
      const tenant = await this.tenants.create(
        { slug: input.slug, name: input.name, limits: input.limits },
        client,
      );
      const tokens = [];
      for (const key of input.keys) {
        const issued = apiKeyToken.issue();
        await this.apiKeys.create(
          {
            tenantId: tenant.id,
            name: key.name,
            publicId: issued.publicId,
            secretHash: issued.secretHash,
            scopes: key.scopes,
          },
          client,
        );
        tokens.push({ name: key.name, token: issued.token, scopes: key.scopes });
      }
      return { tenant, tokens };
    });
  }
}
