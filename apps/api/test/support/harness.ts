import { AddressInfo } from 'node:net';
import { RequestLog, SinkServer } from '@hookline/receiver';
import type { Behaviour } from '@hookline/receiver';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createApiApp } from '../../src/bootstrap';
import { loadAppConfig } from '../../src/config/app-config';
import { Database } from '../../src/shared/database/database.service';
import { DispatchWorker } from '../../src/modules/dispatch/application/dispatch-worker.service';
import { ProvisionTenant } from '../../src/modules/tenants/application/provision-tenant.use-case';
import { SCOPES, Scope } from '../../src/modules/tenants/domain/scope';

export interface Tenant {
  readonly slug: string;
  readonly key: string;
  request: <T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<ApiResponse<T>>;
}

export interface ApiResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * Integration harness.
 *
 * Every test runs against a real PostgreSQL database and a real HTTP receiver in a separate
 * listener, because the behaviour under test - exclusion of concurrent claims, lease recovery,
 * backoff, signature verification over the wire - is precisely the behaviour a mock would assume
 * rather than prove.
 *
 * The dispatcher's own loop is disabled and cycles are driven explicitly, so the tests are
 * deterministic: nothing depends on how fast a background timer happens to fire.
 */
export class Harness {
  private constructor(
    readonly app: NestExpressApplication,
    readonly baseUrl: string,
    readonly database: Database,
    readonly worker: DispatchWorker,
    readonly receiver: SinkServer,
    readonly receiverLog: RequestLog,
    readonly receiverUrl: string,
  ) {}

  static async start(): Promise<Harness> {
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required. Run the suite through `npm test`.');

    const receiverLog = new RequestLog();
    const port = await freePort();
    const receiver = new SinkServer(port, '127.0.0.1', receiverLog);
    await receiver.start();

    const app = await createApiApp({
      config: {
        ...loadAppConfig({
          ...process.env,
          NODE_ENV: 'test',
          DISPATCHER_DISABLED: 'true',
          ALLOW_PRIVATE_DESTINATIONS: 'true',
        }),
      },
      logLevels: [],
    });
    await app.listen(0, '127.0.0.1');

    return new Harness(
      app,
      await app.getUrl(),
      app.get(Database),
      app.get(DispatchWorker),
      receiver,
      receiverLog,
      `http://127.0.0.1:${port}`,
    );
  }

  /** Truncates every table so each test starts from an empty system. */
  async reset(): Promise<void> {
    await this.database.query('TRUNCATE tenants, rate_buckets RESTART IDENTITY CASCADE');
    this.receiverLog.clear();
    await this.receiver.apply({
      mode: 'ok',
      latencyMs: 0,
      failureRate: 0,
      statusCode: 503,
      retryAfterSeconds: null,
      verifySignature: false,
    });
  }

  async behaviour(patch: Partial<Behaviour>): Promise<void> {
    await this.receiver.apply({ ...this.receiver.currentBehaviour, ...patch });
  }

  async tenant(slug: string, scopes: readonly Scope[] = SCOPES): Promise<Tenant> {
    const { tokens } = await this.app.get(ProvisionTenant).execute({
      slug,
      name: slug,
      limits: { ingestRatePerMinute: 6000, ingestBurst: 3000, maxEndpoints: 20 },
      keys: [{ name: 'test', scopes }],
    });
    const key = tokens[0]!.token;

    const request = async <T>(
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ): Promise<ApiResponse<T>> => {
      const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : null) as T,
        headers: response.headers,
      };
    };

    return { slug, key, request };
  }

  /** Brings every pending delivery forward so a cycle can claim it without waiting out a backoff. */
  async fastForward(): Promise<void> {
    await this.database.query(
      `UPDATE deliveries SET next_attempt_at = now() - interval '1 second' WHERE state = 'pending'`,
    );
    await this.database.query(
      `UPDATE endpoints SET circuit_retry_at = now() - interval '1 second' WHERE circuit_retry_at IS NOT NULL`,
    );
  }

  /** Runs dispatch cycles until nothing more can be claimed without advancing the clock. */
  async drain(cycles = 30): Promise<number> {
    return this.worker.drain(cycles);
  }

  async rows<T extends Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.database.query<T>(sql, values);
    return result.rows;
  }

  async stop(): Promise<void> {
    await this.receiver.stop();
    await this.app.close();
  }
}

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}
