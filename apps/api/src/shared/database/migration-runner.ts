import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Pool } from 'pg';

export interface MigrationLogger {
  log(message: string): void;
}

/**
 * Applies versioned SQL migrations inside a session-level advisory lock, so several API instances
 * booting at once converge on the same schema instead of racing. Each applied file is recorded
 * with a checksum: editing a migration that already ran is a mistake worth failing loudly for,
 * because the schema in front of you would no longer match the schema in production.
 */
export async function runMigrations(
  pool: Pool,
  logger: MigrationLogger = console,
): Promise<number> {
  const directory = locateMigrationsDirectory();
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', ['hookline:migrations']);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = new Map<string, string>(
      (
        await client.query<{ version: string; checksum: string }>(
          'SELECT version, checksum FROM schema_migrations',
        )
      ).rows.map((row) => [row.version, row.checksum]),
    );
    let pending = 0;
    for (const file of files) {
      const sql = await readFile(join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(file);
      if (previous === checksum) continue;
      if (previous)
        throw new Error(
          `Migration ${file} changed after it was applied. Add a new migration instead of editing history.`,
        );
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      pending += 1;
      logger.log(`applied migration ${file}`);
    }
    return pending;
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['hookline:migrations'])
      .catch(() => undefined);
    client.release();
  }
}

/**
 * Walks up from the compiled module towards the package root looking for `migrations`, which keeps
 * the runner working whether it is executed from `dist` or from the source tree.
 */
function locateMigrationsDirectory(): string {
  let current = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(current, 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Could not locate the migrations directory.');
}
