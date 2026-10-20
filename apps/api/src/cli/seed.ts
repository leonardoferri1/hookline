import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { INestApplication, Logger } from '@nestjs/common';
import { ApiKeyRepository } from '../modules/tenants/domain/repositories';
import { CONSOLE_SCOPES, PUBLISHER_SCOPES } from '../modules/tenants/domain/scope';
import { apiKeyToken } from '../modules/tenants/domain/api-key';
import { TenantRepository } from '../modules/tenants/domain/repositories';
import { EndpointCatalog } from '../modules/endpoints/application/endpoint-catalog.service';
import { EndpointRepository } from '../modules/endpoints/domain/repositories';
import { PublishEvent } from '../modules/events/application/publish-event.use-case';
import { Clock } from '../shared/clock/clock';

const TENANT_SLUG = 'acme-payments';
const CONSOLE_KEY_NAME = 'Console (local)';
const PUBLISHER_KEY_NAME = 'Publisher (local)';

export interface DemoCredentials {
  tenant: string;
  consoleKey: string;
  publisherKey: string;
  endpoints: Array<{ id: string; name: string; url: string; secret: string }>;
}

/**
 * Prepares a tenant, two scoped keys and a couple of destinations for the local demonstration.
 *
 * Keys are reissued on every boot rather than stored, because Hookline cannot reveal a secret
 * twice: the plaintext exists only at creation. Previous local keys are revoked by name so the
 * list does not accumulate, while the tenant and its delivery history survive restarts - the
 * dashboard is more interesting with yesterday's attempts still in it.
 *
 * Nothing here runs in production mode: the configuration loader refuses that combination.
 */
export async function seedDemoData(
  app: INestApplication,
  options: { receiverUrl: string; credentialsFile?: string },
): Promise<DemoCredentials> {
  const logger = new Logger('DemoSeeder');
  const tenants = app.get(TenantRepository);
  const apiKeys = app.get(ApiKeyRepository);
  const catalog = app.get(EndpointCatalog);
  const endpointsRepo = app.get(EndpointRepository);
  const publish = app.get(PublishEvent);
  const clock = app.get(Clock);

  const tenant =
    (await tenants.findBySlug(TENANT_SLUG)) ??
    (await tenants.create({
      slug: TENANT_SLUG,
      name: 'Acme Payments',
      limits: { ingestRatePerMinute: 600, ingestBurst: 300, maxEndpoints: 20 },
    }));

  const existingKeys = await apiKeys.listByTenant(tenant.id);
  for (const key of existingKeys)
    if (!key.revokedAt && [CONSOLE_KEY_NAME, PUBLISHER_KEY_NAME].includes(key.name))
      await apiKeys.revoke(key.id, tenant.id, clock.now());

  const consoleKey = await issueKey(apiKeys, tenant.id, CONSOLE_KEY_NAME, CONSOLE_SCOPES);
  const publisherKey = await issueKey(apiKeys, tenant.id, PUBLISHER_KEY_NAME, PUBLISHER_SCOPES);

  const wanted = [
    {
      name: 'Billing service',
      path: '/hooks/billing',
      description: 'Receives the payment lifecycle.',
      eventTypes: ['order.*', 'invoice.paid'],
      ordered: false,
    },
    {
      name: 'Analytics pipeline',
      path: '/hooks/analytics',
      description: 'Subscribes to everything, in publication order per customer.',
      eventTypes: ['*'],
      ordered: true,
    },
  ];

  const existingEndpoints = await endpointsRepo.listByTenant(tenant.id);
  const endpoints: DemoCredentials['endpoints'] = [];

  for (const definition of wanted) {
    const url = `${options.receiverUrl}${definition.path}`;
    const already = existingEndpoints.find((endpoint) => endpoint.name === definition.name);
    if (already) {
      // Reissue the secret so the receiver can be handed a value that actually verifies.
      const rotated = await catalog.rotateSecret(tenant.id, already.id, 0);
      endpoints.push({
        id: already.id,
        name: already.name,
        url: already.url,
        secret: rotated.secret,
      });
      continue;
    }
    const created = await catalog.create({
      tenantId: tenant.id,
      limits: tenant.limits,
      name: definition.name,
      url,
      description: definition.description,
      eventTypes: definition.eventTypes,
      ordered: definition.ordered,
      maxAttempts: 6,
      timeoutMs: 3000,
    });
    endpoints.push({
      id: created.endpoint.id,
      name: created.endpoint.name,
      url: created.endpoint.url,
      secret: created.secret,
    });
  }

  if (existingEndpoints.length === 0) await publishSampleEvents(publish, tenant.id);

  const credentials: DemoCredentials = {
    tenant: tenant.slug,
    consoleKey,
    publisherKey,
    endpoints,
  };

  /*
   * Hand the secrets to the receiver here, not from the launcher. The seeder runs before the HTTP
   * server starts listening, which is before the dispatcher's lifecycle hook fires, so the
   * receiver is holding the right secrets before the first delivery can be attempted. Doing it
   * afterwards from outside leaves a window in which real deliveries fail signature checks and
   * trip a breaker on a system that is working correctly.
   */
  await handSecretsToReceiver(endpoints, logger);

  if (options.credentialsFile) {
    const target = resolve(options.credentialsFile);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  }

  logger.log({
    message: 'demo.seeded',
    tenant: tenant.slug,
    endpoints: endpoints.length,
  });

  return credentials;
}

/**
 * Only used for the bundled demonstration receiver, and only when its control token is present in
 * this process's environment. A failure is logged and ignored: the platform does not depend on the
 * test fixture being up.
 */
async function handSecretsToReceiver(
  endpoints: DemoCredentials['endpoints'],
  logger: Logger,
): Promise<void> {
  const controlUrl = process.env.RECEIVER_CONTROL_URL?.trim();
  const token = process.env.RECEIVER_CONTROL_TOKEN?.trim();
  if (!controlUrl || !token || endpoints.length === 0) return;

  try {
    const response = await fetch(`${controlUrl.replace(/\/$/, '')}/control/secrets`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ secrets: endpoints.map((endpoint) => endpoint.secret) }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`the receiver answered ${response.status}`);
    logger.log({ message: 'demo.receiver_secrets_synced', secrets: endpoints.length });
  } catch (error) {
    logger.warn({
      message: 'demo.receiver_secrets_failed',
      error: (error as Error).message,
    });
  }
}

async function issueKey(
  apiKeys: ApiKeyRepository,
  tenantId: string,
  name: string,
  scopes: readonly (
    'events:write' | 'endpoints:read' | 'endpoints:write' | 'deliveries:read' | 'deliveries:replay'
  )[],
): Promise<string> {
  const issued = apiKeyToken.issue('test');
  await apiKeys.create({
    tenantId,
    name,
    publicId: issued.publicId,
    secretHash: issued.secretHash,
    scopes,
  });
  return issued.token;
}

/** A few events so the console has something to show on a first run. */
async function publishSampleEvents(publish: PublishEvent, tenantId: string): Promise<void> {
  const samples = [
    {
      type: 'order.paid',
      partitionKey: 'cus_1042',
      payload: { orderId: 'ord_1042', total: 12990, currency: 'BRL' },
    },
    {
      type: 'order.refunded',
      partitionKey: 'cus_1042',
      payload: { orderId: 'ord_1042', amount: 12990 },
    },
    {
      type: 'invoice.paid',
      partitionKey: 'cus_2087',
      payload: { invoiceId: 'inv_5512', total: 4900 },
    },
    {
      type: 'order.paid',
      partitionKey: 'cus_2087',
      payload: { orderId: 'ord_1043', total: 7350, currency: 'BRL' },
    },
    {
      type: 'customer.created',
      partitionKey: 'cus_3301',
      payload: { customerId: 'cus_3301', plan: 'growth' },
    },
  ];

  for (const sample of samples)
    await publish.execute({
      tenantId,
      type: sample.type,
      payload: sample.payload,
      partitionKey: sample.partitionKey,
      source: 'demo-seeder',
    });
}
