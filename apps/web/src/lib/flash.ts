import 'server-only';
import { cookies } from 'next/headers';

const COOKIE = 'hookline_flash';

export type FlashTone = 'success' | 'error' | 'secret';

export interface Flash {
  tone: FlashTone;
  message: string;
  /** A value shown once, such as a freshly issued signing secret. */
  reveal?: string;
}

/**
 * One-shot messages carried in a cookie rather than a query string.
 *
 * A newly issued signing secret has to reach the next render exactly once. Putting it in the URL
 * would write it into browser history, the referrer of the next request and any access log in
 * between; a cookie read-and-deleted on arrival avoids all three.
 */
export async function setFlash(flash: Flash): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, JSON.stringify(flash), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30,
  });
}

/**
 * Reads the message without clearing it.
 *
 * Next.js only allows a cookie to be modified from a server action or a route handler, never while
 * rendering, so the clearing is done by `DELETE /api/flash` once the notice has been painted. The
 * short max-age is the backstop: with scripting unavailable the message simply expires instead of
 * following the operator around.
 */
export async function peekFlash(): Promise<Flash | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Flash;
  } catch {
    return null;
  }
}

/** Called from the route handler that clears the notice after it has been shown. */
export async function clearFlash(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
