import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startDatabase } from './postgres.mjs';

/**
 * Boots the whole local stack: PostgreSQL, the delivery API, the test receiver and the console.
 *
 * The order matters. The receiver comes up first so the API's seeded destinations point at
 * something real. The API then issues fresh demonstration credentials - signing secrets cannot be
 * read back after creation - and its seeder hands those secrets to the receiver before the
 * dispatcher starts, so no delivery is ever attempted against a receiver that cannot verify it.
 * The console starts last, with the console key already in its environment so the sign-in screen
 * can offer it.
 */

const PORTS = { api: 3021, receiver: 3022, receiverControl: 3023, web: 4310 };
const CREDENTIALS_FILE = resolve('.local/demo.json');
const RECEIVER_CONTROL_TOKEN = randomBytes(24).toString('hex');

const children = [];
let database = null;
let stopping = false;

function run(name, args, env) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`\n${name} exited with code ${code ?? 'unknown'}; stopping the stack.`);
      void stop(code ?? 1);
    }
  });
  children.push({ name, child });
  return child;
}

async function waitFor(url, label, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((done) => setTimeout(done, 400));
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) child.kill();
  await Promise.all(
    children.map(
      ({ child }) =>
        new Promise((done) => (child.exitCode !== null ? done() : child.once('exit', done))),
    ),
  );
  await database?.postgres.stop().catch(() => undefined);
  process.exit(code);
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

database = process.env.DATABASE_URL ? null : await startDatabase();
const databaseUrl = process.env.DATABASE_URL ?? database.url;

run('receiver', ['apps/receiver/dist/src/main.js'], {
  RECEIVER_PORT: String(PORTS.receiver),
  RECEIVER_CONTROL_PORT: String(PORTS.receiverControl),
  RECEIVER_CONTROL_TOKEN,
});

run('api', ['apps/api/dist/src/main.js'], {
  NODE_ENV: 'development',
  DATABASE_URL: databaseUrl,
  PORT: String(PORTS.api),
  CONSOLE_ORIGIN: `http://127.0.0.1:${PORTS.web}`,
  SEED_DEMO: 'true',
  DEMO_CREDENTIALS_FILE: CREDENTIALS_FILE,
  RECEIVER_URL: `http://127.0.0.1:${PORTS.receiver}`,
  // The seeder hands the endpoints' signing secrets to the receiver before dispatching starts.
  RECEIVER_CONTROL_URL: `http://127.0.0.1:${PORTS.receiverControl}`,
  RECEIVER_CONTROL_TOKEN,
  // Loopback destinations are refused by default; the bundled receiver lives there.
  ALLOW_PRIVATE_DESTINATIONS: 'true',
});

await waitFor(`http://127.0.0.1:${PORTS.receiverControl}/control`, 'The test receiver', 40).catch(
  () => undefined,
);
await waitFor(`http://127.0.0.1:${PORTS.api}/api/health/ready`, 'The delivery API');

const credentials = JSON.parse(await readFile(CREDENTIALS_FILE, 'utf8'));

// `next dev` resolves its project from the working directory, so the console is spawned with its
// own cwd rather than through the shared helper.
const nextChild = spawn(
  process.execPath,
  [
    '../../node_modules/next/dist/bin/next',
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(PORTS.web),
  ],
  {
    cwd: resolve('apps/web'),
    env: {
      ...process.env,
      HOOKLINE_API_URL: `http://127.0.0.1:${PORTS.api}`,
      HOOKLINE_DEMO_CONSOLE_KEY: credentials.consoleKey,
      RECEIVER_CONTROL_URL: `http://127.0.0.1:${PORTS.receiverControl}`,
      RECEIVER_SINK_URL: `http://127.0.0.1:${PORTS.receiver}`,
      RECEIVER_CONTROL_TOKEN,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  },
);
nextChild.on('exit', (code) => {
  if (!stopping) void stop(code ?? 1);
});
children.push({ name: 'console', child: nextChild });

console.log(
  [
    '',
    '  Hookline is running.',
    '',
    `  Console          http://127.0.0.1:${PORTS.web}`,
    `  API docs         http://127.0.0.1:${PORTS.api}/api/docs`,
    `  Test receiver    http://127.0.0.1:${PORTS.receiver}/hooks/billing`,
    '',
    '  The console sign-in screen is pre-filled with the demonstration key.',
    `  Credentials were written to ${CREDENTIALS_FILE} (git-ignored).`,
    '',
    '  Stop with Ctrl+C.',
    '',
  ].join('\n'),
);
