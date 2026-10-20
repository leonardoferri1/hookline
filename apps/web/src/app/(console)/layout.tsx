import { redirect } from 'next/navigation';
import { NavLink } from '@/components/nav-link';
import { ApiError, NotConnectedError, callApi } from '@/lib/api-client';
import { endSession, readApiKey } from '@/lib/session';
import type { CurrentPrincipal } from '@/lib/types';

async function signOut(): Promise<void> {
  'use server';
  await endSession();
  redirect('/connect');
}

/**
 * The console shell also acts as the gate: it resolves the session once per navigation and every
 * page under it can assume an authenticated tenant. A key that has been revoked since sign-in
 * fails here, which is where the session is cleared rather than letting each page handle it.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  if (!(await readApiKey())) redirect('/connect');

  let principal: CurrentPrincipal;
  try {
    principal = await callApi<CurrentPrincipal>('/me');
  } catch (error) {
    if (error instanceof NotConnectedError) redirect('/connect');
    if (error instanceof ApiError && error.status === 401) {
      await endSession();
      redirect('/connect?error=invalid');
    }
    throw error;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Hookline</strong>
          <span>console</span>
        </div>

        <nav className="nav" aria-label="Sections">
          <NavLink href="/overview" label="Overview" />
          <NavLink href="/endpoints" label="Endpoints" />
          <NavLink href="/deliveries" label="Deliveries" />
          <NavLink href="/lab" label="Failure drill" />
        </nav>

        <footer>
          <div>
            <strong style={{ color: 'var(--text-muted)' }}>{principal.name}</strong>
            <br />
            {principal.slug} · {principal.apiKeyName}
          </div>
          <div>
            {principal.limits.ingestRatePerMinute}/min ingest · burst {principal.limits.ingestBurst}
          </div>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </footer>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
