import { API_BASE } from '@/lib/api-client';
import { readApiKey } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Proxies the API's event stream.
 *
 * `EventSource` in the browser cannot set an Authorization header, and the API key is deliberately
 * not available to client JavaScript anyway. This handler attaches the key on the server and pipes
 * the upstream body straight through, so the live view works without widening the credential's
 * exposure. The abort signal is forwarded, so closing the page closes the upstream connection
 * rather than leaving it to time out.
 */
export async function GET(request: Request): Promise<Response> {
  const apiKey = await readApiKey();
  if (!apiKey) return new Response('not connected', { status: 401 });

  const upstream = await fetch(`${API_BASE}/api/v1/stream`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'text/event-stream' },
    signal: request.signal,
    cache: 'no-store',
  });

  if (!upstream.ok || !upstream.body)
    return new Response('stream unavailable', { status: upstream.status || 502 });

  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Tells intermediaries not to buffer, which would make a live feed arrive in bursts.
      'x-accel-buffering': 'no',
    },
  });
}
