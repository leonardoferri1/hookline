'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, callApi } from '@/lib/api-client';
import { setFlash } from '@/lib/flash';
import {
  DRILL_ENDPOINT_NAME,
  DRILL_PATH,
  RECEIVER_SINK_URL,
  ReceiverUnavailableError,
  callReceiver,
} from '@/lib/receiver-client';
import type { CreatedEndpoint, Endpoint, ReceiverBehaviour } from '@/lib/types';

async function finish(tone: 'success' | 'error', message: string): Promise<never> {
  await setFlash({ tone, message });
  revalidatePath('/lab');
  redirect('/lab');
}

async function findDrillEndpoint(): Promise<Endpoint | null> {
  const endpoints = await callApi<Endpoint[]>('/endpoints');
  return endpoints.find((endpoint) => endpoint.name === DRILL_ENDPOINT_NAME) ?? null;
}

/**
 * Prepares the drill: registers the destination if it is missing, issues a fresh signing secret
 * and hands that secret to the receiver.
 *
 * The rotation is deliberate. Hookline will not reveal a stored secret twice - that is the whole
 * point of showing it once - so the only honest way for the console to tell the receiver which
 * secret to expect is to issue a new one and pass that value along. The previous secret is retired
 * immediately, because no real consumer is holding it.
 */
export async function prepareDrill(): Promise<void> {
  try {
    const existing = await findDrillEndpoint();
    const url = `${RECEIVER_SINK_URL}${DRILL_PATH}`;
    let secret: string;

    if (existing) {
      const rotated = await callApi<CreatedEndpoint>(`/endpoints/${existing.id}/secrets/rotate`, {
        method: 'POST',
        body: { graceSeconds: 0 },
      });
      secret = rotated.secret;
      if (existing.url !== url || existing.status !== 'enabled')
        await callApi<Endpoint>(`/endpoints/${existing.id}`, {
          method: 'PATCH',
          body: { url, status: 'enabled' },
        });
    } else {
      const created = await callApi<CreatedEndpoint>('/endpoints', {
        method: 'POST',
        body: {
          name: DRILL_ENDPOINT_NAME,
          url,
          description: 'Bundled receiver used to rehearse outages, latency and signature failures.',
          eventTypes: ['drill.*'],
          maxAttempts: 6,
          timeoutMs: 2000,
        },
      });
      secret = created.secret;
    }

    await callReceiver('/control/secrets', { method: 'PUT', body: { secrets: [secret] } });
    await finish(
      'success',
      existing
        ? 'Ready. A fresh secret was issued and handed to the receiver, which now verifies every request.'
        : 'Ready. The drill destination was registered and the receiver holds its signing secret.',
    );
  } catch (error) {
    if (error instanceof ReceiverUnavailableError) await finish('error', error.message);
    if (error instanceof ApiError) await finish('error', error.message);
    throw error;
  }
}

export async function updateBehaviour(formData: FormData): Promise<void> {
  const patch: Partial<ReceiverBehaviour> = {
    mode: (formData.get('mode') as ReceiverBehaviour['mode']) ?? 'ok',
    latencyMs: Number(formData.get('latencyMs')) || 0,
    failureRate: Number(formData.get('failureRate')) || 0,
    statusCode: Number(formData.get('statusCode')) || 503,
    retryAfterSeconds: formData.get('retryAfterSeconds')
      ? Number(formData.get('retryAfterSeconds'))
      : null,
    verifySignature: formData.get('verifySignature') === 'on',
  };

  try {
    await callReceiver('/control', { method: 'PUT', body: patch });
    await finish(
      'success',
      patch.mode === 'offline'
        ? 'The receiver stopped listening. Deliveries will record refused connections, not error responses.'
        : `The receiver is now in ${patch.mode} mode.`,
    );
  } catch (error) {
    if (error instanceof ReceiverUnavailableError) await finish('error', error.message);
    throw error;
  }
}

export async function clearReceiverLog(): Promise<void> {
  try {
    await callReceiver('/control/requests', { method: 'DELETE' });
    await finish('success', 'Receiver log cleared.');
  } catch (error) {
    if (error instanceof ReceiverUnavailableError) await finish('error', error.message);
    throw error;
  }
}

/**
 * Publishes a burst of drill events. Each one gets its own idempotency key so a double submit
 * does not inflate the drill, and a shared partition key when ordering is requested, which is what
 * makes the ordered-delivery behaviour observable.
 */
export async function publishBurst(formData: FormData): Promise<void> {
  const count = Math.min(Math.max(Number(formData.get('count')) || 5, 1), 50);
  const partitionKey = String(formData.get('partitionKey') ?? '').trim() || undefined;
  const batch = randomUUID().slice(0, 8);

  let published = 0;
  let refused: string | null = null;

  for (let index = 0; index < count; index += 1) {
    try {
      await callApi('/events', {
        method: 'POST',
        idempotencyKey: `drill-${batch}-${index}`,
        body: {
          type: 'drill.order-paid',
          source: 'console-drill',
          partitionKey,
          payload: {
            batch,
            sequence: index + 1,
            of: count,
            orderId: `ord_${batch}_${index + 1}`,
            total: 1290 + index,
            currency: 'BRL',
          },
        },
      });
      published += 1;
    } catch (error) {
      if (error instanceof ApiError) {
        refused = error.code === 'rate_limited' ? 'the tenant ingest quota' : error.message;
        break;
      }
      throw error;
    }
  }

  if (published === 0)
    await finish(
      'error',
      refused ? `Nothing published: ${refused} refused it.` : 'Nothing published.',
    );

  await finish(
    'success',
    refused
      ? `Published ${published} of ${count}; ${refused} stopped the rest. Watch the live feed.`
      : `Published ${published} event${published === 1 ? '' : 's'}. Watch the live feed.`,
  );
}
