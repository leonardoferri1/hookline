import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The console is served behind the same origin as its own route handlers; nothing is exported.
  poweredByHeader: false,
  /*
   * Typed routes are left off on purpose. The console builds a few hrefs from parts - the metrics
   * window picker appends a query string to whatever path it is placed on - and those cannot be
   * proven against the route table without casting at every call site, which trades a real type
   * error for a silenced one.
   */
};

export default config;
