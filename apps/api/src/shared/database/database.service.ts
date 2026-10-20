import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { APP_CONFIG, AppConfig } from '../../config/app-config';

/**
 * The narrow surface repositories depend on. Both the pool and a transaction client satisfy it,
 * which is what lets a use case pass its open transaction down into several repositories.
 */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

/**
 * Owns the connection pool and the transaction boundary.
 *
 * Repositories accept a `Queryable` so a use case can compose several of them inside one
 * transaction: the event row, its deliveries and its audit trail must commit together or not at
 * all. Advisory locks are exposed because the dispatcher and the idempotency path need to
 * serialize concurrent callers that are not contending on a single row.
 */
@Injectable()
export class Database implements Queryable, OnApplicationShutdown {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.databasePoolSize,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      idle_in_transaction_session_timeout: 30000,
      application_name: 'hookline-api',
    });
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values as unknown[]);
  }

  /** Resolves to the caller's transaction when there is one, and to the pool otherwise. */
  with(client?: Queryable): Queryable {
    return client ?? this;
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Runs `work` while holding a transaction-scoped advisory lock derived from `key`. */
  async withAdvisoryLock<T>(key: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      return work(client);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
