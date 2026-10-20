'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-runs the server components on an interval.
 *
 * Metrics are aggregated server-side, so the page needs a nudge to recompute them; the live feed
 * covers the second-by-second detail. Refreshing beats making every tile a client component that
 * fetches for itself.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  return null;
}
