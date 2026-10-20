import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../shared/database/database.service';
import { CreateTenantInput, TenantRepository } from '../domain/repositories';
import { Tenant } from '../domain/tenant';
import { TenantRow, toTenant } from './row-mappers';

const COLUMNS = `id, slug, name, ingest_rate_per_minute, ingest_burst, max_endpoints, created_at`;

@Injectable()
export class PostgresTenantRepository extends TenantRepository {
  constructor(private readonly database: Database) {
    super();
  }

  override async findById(id: string, client?: Queryable): Promise<Tenant | null> {
    const result = await this.database
      .with(client)
      .query<TenantRow>(`SELECT ${COLUMNS} FROM tenants WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? toTenant(row) : null;
  }

  override async findBySlug(slug: string, client?: Queryable): Promise<Tenant | null> {
    const result = await this.database
      .with(client)
      .query<TenantRow>(`SELECT ${COLUMNS} FROM tenants WHERE slug = $1`, [slug]);
    const row = result.rows[0];
    return row ? toTenant(row) : null;
  }

  override async create(input: CreateTenantInput, client?: Queryable): Promise<Tenant> {
    const result = await this.database.with(client).query<TenantRow>(
      `INSERT INTO tenants (slug, name, ingest_rate_per_minute, ingest_burst, max_endpoints)
       VALUES ($1, $2, COALESCE($3, 120), COALESCE($4, 60), COALESCE($5, 20))
       RETURNING ${COLUMNS}`,
      [
        input.slug,
        input.name,
        input.limits?.ingestRatePerMinute ?? null,
        input.limits?.ingestBurst ?? null,
        input.limits?.maxEndpoints ?? null,
      ],
    );
    return toTenant(result.rows[0]!);
  }
}
