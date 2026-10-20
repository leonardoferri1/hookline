'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, callApi } from '@/lib/api-client';
import { setFlash } from '@/lib/flash';
import type { CreatedEndpoint, Endpoint } from '@/lib/types';

/**
 * Mutations run as server actions, so the API key stays on the server and no browser-side client
 * needs to exist. Each action translates the API's problem code into a message an operator can act
 * on, then revalidates the affected path rather than reloading the whole console.
 */

function splitEventTypes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function createEndpoint(formData: FormData): Promise<void> {
  const body = {
    name: String(formData.get('name') ?? '').trim(),
    url: String(formData.get('url') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim() || undefined,
    eventTypes: splitEventTypes(String(formData.get('eventTypes') ?? '')),
    maxAttempts: Number(formData.get('maxAttempts')) || undefined,
    timeoutMs: Number(formData.get('timeoutMs')) || undefined,
    ordered: formData.get('ordered') === 'on',
  };

  let created: CreatedEndpoint;
  try {
    created = await callApi<CreatedEndpoint>('/endpoints', { method: 'POST', body });
  } catch (error) {
    if (error instanceof ApiError) {
      await setFlash({ tone: 'error', message: error.message });
      redirect('/endpoints');
    }
    throw error;
  }

  await setFlash({
    tone: 'secret',
    message: `${created.endpoint.name} is registered. Copy its signing secret now: it is not shown again.`,
    reveal: created.secret,
  });
  redirect(`/endpoints/${created.endpoint.id}`);
}

export async function rotateSecret(formData: FormData): Promise<void> {
  const endpointId = String(formData.get('endpointId'));
  const graceSeconds = Number(formData.get('graceSeconds'));

  try {
    const rotated = await callApi<CreatedEndpoint>(`/endpoints/${endpointId}/secrets/rotate`, {
      method: 'POST',
      body: { graceSeconds: Number.isFinite(graceSeconds) ? graceSeconds : undefined },
    });
    await setFlash({
      tone: 'secret',
      message:
        graceSeconds === 0
          ? 'Rotated. The previous secret stopped signing immediately.'
          : 'Rotated. Both secrets sign outgoing requests until the grace window closes.',
      reveal: rotated.secret,
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await setFlash({ tone: 'error', message: error.message });
  }

  redirect(`/endpoints/${endpointId}`);
}

export async function setEndpointStatus(formData: FormData): Promise<void> {
  const endpointId = String(formData.get('endpointId'));
  const status = formData.get('status') === 'paused' ? 'paused' : 'enabled';

  try {
    await callApi<Endpoint>(`/endpoints/${endpointId}`, { method: 'PATCH', body: { status } });
    await setFlash({
      tone: 'success',
      message:
        status === 'paused'
          ? 'Paused. Queued deliveries stay queued and nothing is sent until it is enabled again.'
          : 'Enabled, and the circuit breaker was closed. The queued backlog will be attempted.',
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await setFlash({ tone: 'error', message: error.message });
  }

  revalidatePath(`/endpoints/${endpointId}`);
  redirect(`/endpoints/${endpointId}`);
}

export async function updateEndpoint(formData: FormData): Promise<void> {
  const endpointId = String(formData.get('endpointId'));
  const body = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    url: String(formData.get('url') ?? '').trim() || undefined,
    eventTypes: splitEventTypes(String(formData.get('eventTypes') ?? '')),
    maxAttempts: Number(formData.get('maxAttempts')) || undefined,
    timeoutMs: Number(formData.get('timeoutMs')) || undefined,
    ordered: formData.get('ordered') === 'on',
  };

  try {
    await callApi<Endpoint>(`/endpoints/${endpointId}`, { method: 'PATCH', body });
    await setFlash({
      tone: 'success',
      message: 'Saved. Deliveries already queued keep the retry budget they were given.',
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await setFlash({ tone: 'error', message: error.message });
  }

  revalidatePath(`/endpoints/${endpointId}`);
  redirect(`/endpoints/${endpointId}`);
}

export async function deleteEndpoint(formData: FormData): Promise<void> {
  const endpointId = String(formData.get('endpointId'));

  try {
    await callApi<void>(`/endpoints/${endpointId}`, { method: 'DELETE' });
    await setFlash({
      tone: 'success',
      message: 'Endpoint removed, along with its delivery history.',
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await setFlash({ tone: 'error', message: error.message });
    redirect(`/endpoints/${endpointId}`);
  }

  redirect('/endpoints');
}
