import { redirect } from 'next/navigation';
import { ApiError, callApi } from '@/lib/api-client';
import { demoApiKey, startSession } from '@/lib/session';
import type { CurrentPrincipal } from '@/lib/types';

/**
 * Sign-in is "present a tenant API key", and the console verifies it against the API before
 * accepting it.
 *
 * There is deliberately no separate user store: the API already owns credentials with scopes, and
 * inventing console accounts on top would mean two things to keep in sync and two places to
 * revoke. The key is validated here, then stored HttpOnly so the browser never holds it.
 */
async function connect(formData: FormData): Promise<void> {
  'use server';
  const apiKey = String(formData.get('apiKey') ?? '').trim();
  if (!apiKey) redirect('/connect?error=missing');

  try {
    await callApi<CurrentPrincipal>('/me', { apiKey });
  } catch (error) {
    if (error instanceof ApiError)
      redirect(`/connect?error=${error.status === 401 ? 'invalid' : 'unreachable'}`);
    redirect('/connect?error=unreachable');
  }

  await startSession(apiKey);
  redirect('/overview');
}

const MESSAGES: Record<string, string> = {
  missing: 'Paste an API key to continue.',
  invalid: 'That key was refused. Check for a truncated paste.',
  unreachable: 'The delivery API did not answer. Is it running on this machine?',
};

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const demo = demoApiKey();

  return (
    <main className="connect">
      <div className="card connect-card">
        <h1>Hookline</h1>
        <p>
          Publish events, deliver them to signed destinations, retry what fails and replay what
          needs it. Open the console with a tenant API key.
        </p>

        {error ? (
          <div className="notice error" style={{ marginBottom: 16 }} role="alert">
            {MESSAGES[error] ?? 'That key could not be used.'}
          </div>
        ) : null}

        <form action={connect} className="stack">
          <div className="field">
            <label htmlFor="apiKey">Tenant API key</label>
            <input
              id="apiKey"
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="hk_live_…"
              defaultValue={demo ?? ''}
              required
            />
            <p className="hint">
              Stored in an HttpOnly cookie for this browser only. It is never exposed to client-side
              JavaScript and never leaves this machine.
            </p>
          </div>
          <div className="row">
            <button type="submit" className="primary">
              Open console
            </button>
            {demo ? <span className="hint">The local demo key is pre-filled.</span> : null}
          </div>
        </form>
      </div>
    </main>
  );
}
