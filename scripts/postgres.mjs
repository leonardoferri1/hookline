import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Starts a real PostgreSQL server for local development and tests.
 *
 * Development runs reuse a persistent cluster in `.local/postgres` so data survives restarts.
 * Test runs create a throwaway cluster with a random password on a separate port, which keeps
 * the suite independent from whatever is running on the developer machine.
 */
export async function startDatabase({ test = false } = {}) {
  const password = test ? randomBytes(24).toString('hex') : 'hookline-local-only';
  const port = test ? 55442 : 55441;
  const databaseDir = resolve(test ? `.local/test-${Date.now()}` : '.local/postgres');
  const postgres = new EmbeddedPostgres({
    databaseDir,
    user: 'hookline',
    password,
    port,
    persistent: !test,
    authMethod: 'scram-sha-256',
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {},
    onError: (message) => {
      if (String(message).includes('FATAL')) console.error(message);
    },
  });
  if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) await postgres.initialise();
  await postgres.start();
  const client = postgres.getPgClient();
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'hookline'");
  if (!exists.rowCount) await client.query('CREATE DATABASE hookline');
  await client.end();
  return { postgres, url: `postgresql://hookline:${password}@127.0.0.1:${port}/hookline` };
}
