import { EnvironmentReader } from './env';

export type RuntimeMode = 'development' | 'test' | 'production';

export interface AppConfig {
  readonly mode: RuntimeMode;
  readonly port: number;
  readonly consoleOrigin: string;
  readonly databaseUrl: string;
  readonly databasePoolSize: number;
  readonly seedDemoData: boolean;
  /** Where the seeder writes the freshly issued demonstration credentials. */
  readonly demoCredentialsFile: string | undefined;
  /** Base URL of the bundled test receiver, used for the seeded destinations. */
  readonly receiverUrl: string;
  readonly maxPayloadBytes: number;
  readonly dispatch: DispatchConfig;
}

export interface DispatchConfig {
  /** A disabled dispatcher lets tests drive delivery attempts deterministically. */
  readonly enabled: boolean;
  /** How many deliveries a single dispatcher cycle claims. */
  readonly batchSize: number;
  /** Pause between cycles when the queue is empty, in milliseconds. */
  readonly idleIntervalMs: number;
  /** How long a claimed delivery stays leased before another worker may recover it. */
  readonly leaseSeconds: number;
  /** Per-request timeout applied to destination endpoints, in milliseconds. */
  readonly requestTimeoutMs: number;
  /** Maximum stored response body per attempt, in bytes. */
  readonly maxStoredResponseBytes: number;
  /**
   * Destinations on loopback or private ranges are refused unless explicitly allowed. The local
   * demonstration enables this so deliveries can reach the bundled test receiver.
   */
  readonly allowPrivateDestinations: boolean;
}

export function loadAppConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = new EnvironmentReader(source);
  const mode = env.oneOf('NODE_ENV', ['development', 'test', 'production'] as const, 'development');
  const config: AppConfig = {
    mode,
    port: env.integer('PORT', 3021, { min: 1, max: 65535 }),
    consoleOrigin: env.string('CONSOLE_ORIGIN', 'http://127.0.0.1:4310'),
    databaseUrl: env.string('DATABASE_URL'),
    databasePoolSize: env.integer('DATABASE_POOL_SIZE', 20, { min: 2, max: 200 }),
    seedDemoData: env.boolean('SEED_DEMO', false),
    demoCredentialsFile: source.DEMO_CREDENTIALS_FILE?.trim() || undefined,
    receiverUrl: env.string('RECEIVER_URL', 'http://127.0.0.1:3022'),
    maxPayloadBytes: env.integer('MAX_PAYLOAD_BYTES', 262144, { min: 1024 }),
    dispatch: {
      enabled: !env.boolean('DISPATCHER_DISABLED', false),
      batchSize: env.integer('DISPATCH_BATCH_SIZE', 20, { min: 1, max: 500 }),
      idleIntervalMs: env.integer('DISPATCH_IDLE_INTERVAL_MS', 500, { min: 50 }),
      leaseSeconds: env.integer('DISPATCH_LEASE_SECONDS', 60, { min: 5 }),
      requestTimeoutMs: env.integer('DISPATCH_REQUEST_TIMEOUT_MS', 10000, { min: 100 }),
      maxStoredResponseBytes: env.integer('DISPATCH_MAX_RESPONSE_BYTES', 8192, { min: 256 }),
      allowPrivateDestinations: env.boolean('ALLOW_PRIVATE_DESTINATIONS', mode !== 'production'),
    },
  };
  env.assertValid();
  if (config.seedDemoData && config.mode === 'production')
    throw new Error('Refusing to seed demonstration data in production mode.');
  return config;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
