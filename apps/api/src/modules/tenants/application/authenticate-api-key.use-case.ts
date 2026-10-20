import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/clock/clock';
import { UnauthorizedError } from '../../../shared/errors/domain-error';
import { apiKeyToken } from '../domain/api-key';
import { ApiKeyRepository, TenantRepository } from '../domain/repositories';
import { Principal } from './principal';

/**
 * A digest of an impossible secret. Unknown public ids are still compared against it so the
 * response time of a wrong key does not reveal whether that key exists.
 */
const DECOY_HASH = '0'.repeat(64);

/** How stale `last_used_at` may get before the key row is written again. */
const LAST_USED_RESOLUTION_MS = 60_000;

@Injectable()
export class AuthenticateApiKey {
  constructor(
    private readonly apiKeys: ApiKeyRepository,
    private readonly tenants: TenantRepository,
    private readonly clock: Clock,
  ) {}

  async execute(presentedToken: string | undefined): Promise<Principal> {
    const parsed = presentedToken ? apiKeyToken.parse(presentedToken) : null;
    if (!parsed) throw new UnauthorizedError('The API key is missing or malformed.');

    const key = await this.apiKeys.findByPublicId(parsed.publicId);
    const secretMatches = apiKeyToken.matches(parsed.secret, key?.secretHash ?? DECOY_HASH);
    if (!key || !secretMatches) throw new UnauthorizedError('The API key is not valid.');
    if (key.revokedAt) throw new UnauthorizedError('The API key has been revoked.');

    const tenant = await this.tenants.findById(key.tenantId);
    if (!tenant) throw new UnauthorizedError('The API key is not valid.');

    this.recordUsage(key.id, key.lastUsedAt);

    return {
      tenant,
      apiKeyId: key.id,
      apiKeyName: key.name,
      scopes: key.scopes,
    };
  }

  /**
   * Usage tracking must not add a write to every authenticated request. The timestamp is only
   * refreshed once per minute, and a failure is logged by the caller rather than failing the
   * request: a stale `last_used_at` is less harmful than a rejected delivery.
   */
  private recordUsage(apiKeyId: string, lastUsedAt: Date | null): void {
    const now = this.clock.now();
    if (lastUsedAt && now.getTime() - lastUsedAt.getTime() < LAST_USED_RESOLUTION_MS) return;
    void this.apiKeys.touchLastUsed(apiKeyId, now).catch(() => undefined);
  }
}
