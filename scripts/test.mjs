import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { startDatabase } from './postgres.mjs';

/**
 * Runs the integration suite against a throwaway PostgreSQL cluster.
 *
 * The suite talks to a real database and a real HTTP listener on purpose: concurrent claims,
 * lease recovery and signature verification over the wire are exactly the behaviours a mock would
 * assume rather than prove. CI uses `npm run test:external` instead, pointing at its own service.
 */
const database = await startDatabase({ test: true });

const child = spawn(
  process.execPath,
  ['--test', 'apps/api/dist/test/unit/*.test.js', 'apps/api/dist/test/integration/*.test.js'],
  {
    env: {
      ...process.env,
      DATABASE_URL: database.url,
      NODE_ENV: 'test',
      DISPATCHER_DISABLED: 'true',
      ALLOW_PRIVATE_DESTINATIONS: 'true',
    },
    stdio: 'inherit',
    windowsHide: true,
  },
);

const code = await new Promise((resolve) => child.on('exit', resolve));

await database.postgres.stop().catch(() => undefined);
await rm(database.directory, { recursive: true, force: true }).catch(() => undefined);

process.exit(code ?? 1);
