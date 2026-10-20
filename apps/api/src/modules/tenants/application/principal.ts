import { Scope } from '../domain/scope';
import { Tenant } from '../domain/tenant';

/** The authenticated caller: a tenant, the key it presented, and what that key may do. */
export interface Principal {
  readonly tenant: Tenant;
  readonly apiKeyId: string;
  readonly apiKeyName: string;
  readonly scopes: readonly Scope[];
}

export function hasScopes(principal: Principal, required: readonly Scope[]): boolean {
  return required.every((scope) => principal.scopes.includes(scope));
}
