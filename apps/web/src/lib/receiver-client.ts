import 'server-only';
import type { ReceiverState } from './types';

export const RECEIVER_CONTROL_URL =
  process.env.RECEIVER_CONTROL_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:3023';

export const RECEIVER_SINK_URL =
  process.env.RECEIVER_SINK_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:3022';

/** Path the drill endpoint delivers to. */
export const DRILL_PATH = '/hooks/drill';
export const DRILL_ENDPOINT_NAME = 'Failure drill receiver';

export class ReceiverUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ReceiverUnavailableError';
  }
}

/**
 * Server-side client for the test receiver's control plane.
 *
 * The control token stays in the console's own environment and is never sent to the browser, so
 * the drill controls are exercised through server actions rather than by letting the page talk to
 * the receiver directly. A console deployed anywhere real simply has no token configured, and the
 * drill page says so instead of failing.
 */
export async function callReceiver<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = process.env.RECEIVER_CONTROL_TOKEN?.trim();
  if (!token)
    throw new ReceiverUnavailableError(
      'RECEIVER_CONTROL_TOKEN is not set for the console, so the drill receiver cannot be controlled from here.',
    );

  let response: Response;
  try {
    response = await fetch(`${RECEIVER_CONTROL_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    });
  } catch (error) {
    throw new ReceiverUnavailableError(
      `The drill receiver did not answer on ${RECEIVER_CONTROL_URL}: ${(error as Error).message}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    const problem = safeParse(text) as { message?: string } | null;
    throw new ReceiverUnavailableError(
      problem?.message ?? `The drill receiver answered ${response.status}.`,
    );
  }
  return safeParse(text) as T;
}

export function receiverState(): Promise<ReceiverState> {
  return callReceiver<ReceiverState>('/control');
}

function safeParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
