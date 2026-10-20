import 'server-only';
import { cookies } from 'next/headers';

const COOKIE = 'hookline_key';
const MAX_AGE_SECONDS = 60 * 60 * 12;

/**
 * The console keeps the tenant's API key in an HttpOnly cookie and never hands it to the browser.
 *
 * Every read goes through a server component or a route handler that attaches the key on the
 * server side, so the credential is not reachable from client JavaScript and a cross-site script
 * cannot exfiltrate it. The cookie is the whole session: there is no second user store to keep in
 * sync with the keys the API already owns.
 */
export async function readApiKey(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

export async function startSession(apiKey: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, apiKey, {
    httpOnly: true,
    sameSite: 'lax',
    // Set over plain HTTP locally; a hosted deployment serves the console over TLS.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/** The demo key the local runner exposes, offered on the connect screen as a one-click sign-in. */
export function demoApiKey(): string | null {
  return process.env.HOOKLINE_DEMO_CONSOLE_KEY?.trim() || null;
}
