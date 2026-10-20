import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../shared/database/database.service';
import { EndpointSecret } from '../domain/endpoint';
import { EndpointSecretRepository } from '../domain/repositories';
import { EndpointSecretRow, toEndpointSecret } from './endpoint-row';

const COLUMNS = 'id, endpoint_id, secret, created_at, expires_at';

@Injectable()
export class PostgresEndpointSecretRepository extends EndpointSecretRepository {
  constructor(private readonly database: Database) {
    super();
  }

  override async listByEndpoint(endpointId: string, client?: Queryable): Promise<EndpointSecret[]> {
    const result = await this.database
      .with(client)
      .query<EndpointSecretRow>(
        `SELECT ${COLUMNS} FROM endpoint_secrets WHERE endpoint_id = $1 ORDER BY created_at DESC`,
        [endpointId],
      );
    return result.rows.map(toEndpointSecret);
  }

  override async add(
    endpointId: string,
    secret: string,
    client?: Queryable,
  ): Promise<EndpointSecret> {
    const result = await this.database
      .with(client)
      .query<EndpointSecretRow>(
        `INSERT INTO endpoint_secrets (endpoint_id, secret) VALUES ($1, $2) RETURNING ${COLUMNS}`,
        [endpointId, secret],
      );
    return toEndpointSecret(result.rows[0]!);
  }

  /** Never extends an existing window: a secret already expiring sooner keeps its deadline. */
  override async expireOthers(
    endpointId: string,
    keepSecretId: string,
    expiresAt: Date,
    client?: Queryable,
  ): Promise<void> {
    await this.database.with(client).query(
      `UPDATE endpoint_secrets
          SET expires_at = LEAST(COALESCE(expires_at, $3), $3)
        WHERE endpoint_id = $1 AND id <> $2`,
      [endpointId, keepSecretId, expiresAt],
    );
  }
}
