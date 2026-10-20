import { Pool } from 'pg';
import { loadAppConfig } from '../config/app-config';
import { runMigrations } from '../shared/database/migration-runner';

/** Applies pending migrations and exits; used by CI and by operators ahead of a deploy. */
async function main(): Promise<void> {
  const config = loadAppConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
  try {
    const applied = await runMigrations(pool);
    console.log(applied === 0 ? 'schema already up to date' : `${applied} migration(s) applied`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
