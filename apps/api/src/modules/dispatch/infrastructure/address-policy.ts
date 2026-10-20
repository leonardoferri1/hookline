import { isIP } from 'node:net';

export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'shared'
  | 'unspecified'
  | 'multicast'
  | 'reserved';

/**
 * A webhook sender is an attacker-controlled HTTP client: whoever configures an endpoint chooses
 * the URL this server will connect to, which is the textbook setup for server-side request
 * forgery. Addresses that only make sense inside the deployment - the metadata service, the
 * database, a neighbouring pod - are refused before a connection is opened.
 *
 * The local demonstration deliberately allows loopback, because the bundled test receiver runs
 * there; in a hosted deployment that switch stays off.
 */
export function classifyAddress(address: string): AddressClass {
  const version = isIP(address);
  if (version === 4) return classifyIPv4(address);
  if (version === 6) return classifyIPv6(address.toLowerCase());
  return 'reserved';
}

export function isBlockedAddress(address: string): boolean {
  return classifyAddress(address) !== 'public';
}

function classifyIPv4(address: string): AddressClass {
  const octets = address.split('.').map(Number);
  const [a = 0, b = 0] = octets;
  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  // Carrier-grade NAT, routable inside some providers but never a legitimate webhook destination.
  if (a === 100 && b >= 64 && b <= 127) return 'shared';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return 'public';
}

function classifyIPv6(address: string): AddressClass {
  if (address === '::') return 'unspecified';
  if (address === '::1') return 'loopback';

  // IPv4-mapped and IPv4-translated forms reach the same hosts, so they get the same verdict.
  const mapped = /^::ffff:(?:0:)?([0-9.]+)$/.exec(address);
  if (mapped?.[1] && isIP(mapped[1]) === 4) return classifyIPv4(mapped[1]);

  const head = address.split(':')[0] ?? '';
  const prefix = Number.parseInt(head.padEnd(4, '0'), 16);
  if (Number.isNaN(prefix)) return 'reserved';
  if ((prefix & 0xffc0) === 0xfe80) return 'link-local';
  if ((prefix & 0xfe00) === 0xfc00) return 'private';
  if ((prefix & 0xff00) === 0xff00) return 'multicast';
  if (address.startsWith('2001:db8')) return 'reserved';
  return 'public';
}
