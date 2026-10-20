'use client';

import { useEffect } from 'react';

/** Dismisses the server-side notice after it has been painted, so it shows exactly once. */
export function FlashCleanup() {
  useEffect(() => {
    void fetch('/api/flash', { method: 'DELETE' }).catch(() => undefined);
  }, []);

  return null;
}
