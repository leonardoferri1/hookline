import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../shared/database/database.service';
import { ApiKey } from '../domain/api-key';
import { ApiKeyRepository, CreateApiKeyInput } from '../domain/repositories';
import { ApiKeyRow, toApiKey } from './row-mappers';

const COLUMNS = `id, tenant_id, name, public_id, secret_hash, scopes, last_used_at, revoked_at, created_at`;

@Injectable()
export class PostgresApiKeyRepository extends ApiKeyRepository {
  constructor(private readonly database: Database) {
    super();
  }

  override async findByPublicId(publicId: string, client?: Queryable): Promise<ApiKey | null> {
    const result = await this.database
      .with(client)
      .query<ApiKeyRow>(`SELECT ${COLUMNS} FROM api_keys WHERE public_id = $1`, [publicId]);
    const row = result.rows[0];
    return row ? toApiKey(row) : null;
  }

  override async listByTenant(tenantId: string, client?: Queryable): Promise<ApiKey[]> {
    const result = await this.database
      .with(client)
      .query<ApiKeyRow>(
        `SELECT ${COLUMNS} FROM api_keys WHERE tenant_id = $1 ORDER BY created_at`,
        [tenantId],
      );
    return result.rows.map(toApiKey);
  }

  override async create(input: CreateApiKeyInput, client?: Queryable): Promise<ApiKey> {
    const result = await this.database.with(client).query<ApiKeyRow>(
      `INSERT INTO api_keys (tenant_id, name, public_id, secret_hash, scopes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [input.tenantId, input.name, input.publicId, input.secretHash, [...input.scopes]],
    );
    return toApiKey(result.rows[0]!);
  }

  override async touchLastUsed(id: string, usedAt: Date, client?: Queryable): Promise<void> {
    await this.database
      .with(client)
      .query(`UPDATE api_keys SET last_used_at = $2 WHERE id = $1`, [id, usedAt]);
  }

  override async revoke(
    id: string,
    tenantId: string,
    revokedAt: Date,
    client?: Queryable,
  ): Promise<boolean> {
    const result = await this.database.with(client).query(
      `UPDATE api_keys SET revoked_at = $3
       WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
      [id, tenantId, revokedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
