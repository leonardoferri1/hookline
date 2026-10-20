'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, callApi } from '@/lib/api-client';
import { setFlash } from '@/lib/flash';
import { pluralize } from '@/lib/format';
import type { Delivery } from '@/lib/types';

export async function replayDelivery(formData: FormData): Promise<void> {
  const deliveryId = String(formData.get('deliveryId'));

  try {
    const replayed = await callApi<{ id: string }>(`/deliveries/${deliveryId}/replay`, {
      method: 'POST',
    });
    await setFlash({
      tone: 'success',
      message: 'Queued again as a new delivery. The original record is untouched.',
    });
    redirect(`/deliveries/${replayed.id}`);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await setFlash({ tone: 'error', message: error.message });
    redirect(`/deliveries/${deliveryId}`);
  }
}

export async function cancelDelivery(formData: FormData): Promise<void> {
  const deliveryId = String(formData.get('deliveryId'));

  try {
    await callApi<Delivery>(`/deliveries/${deliveryId}/cancel`, { method: 'POST' });
    await setFlash({ tone: 'success', message: 'Withdrawn before it was attempted.' });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await setFlash({ tone: 'error', message: error.message });
  }

  revalidatePath(`/deliveries/${deliveryId}`);
  redirect(`/deliveries/${deliveryId}`);
}

/**
 * The move an operator makes once a destination is back: re-queue its whole failed backlog in
 * publication order. The API caps how much one call can re-queue, and the message reports when it
 * stopped short so the operator knows to run it again.
 */
export async function replayEndpointBacklog(formData: FormData): Promise<void> {
  const endpointId = String(formData.get('endpointId'));

  try {
    const result = await callApi<{ requeued: unknown[]; skipped: number }>('/deliveries/replay', {
      method: 'POST',
      body: { endpointId, states: ['failed'] },
    });
    await setFlash({
      tone: result.requeued.length > 0 ? 'success' : 'error',
      message:
        result.requeued.length === 0
          ? 'Nothing to replay: this destination has no exhausted deliveries.'
          : `Re-queued ${pluralize(result.requeued.length, 'delivery', 'deliveries')}, oldest first.${
              result.skipped > 0 ? ` ${result.skipped} left over the per-call limit.` : ''
            }`,
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await setFlash({ tone: 'error', message: error.message });
  }

  revalidatePath('/deliveries');
  redirect(`/deliveries?endpointId=${endpointId}&state=failed`);
}
