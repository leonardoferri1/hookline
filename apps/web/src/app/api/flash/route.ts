import { clearFlash } from '@/lib/flash';

export const dynamic = 'force-dynamic';

/**
 * Clears the one-shot notice once it has been rendered. It lives in a route handler because that
 * and server actions are the only places Next.js permits a cookie to be modified.
 */
export async function DELETE(): Promise<Response> {
  await clearFlash();
  return new Response(null, { status: 204 });
}
