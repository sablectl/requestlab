// Destination classification and the connection-boundary guard.
//
// URL string inspection cannot decide whether a request is safe: a name
// resolves to an address, the address is what is connected to, and the two can
// disagree — deliberately, in a DNS rebinding attack. So classification works
// on resolved addresses, and the guard is installed as the `lookup` function
// the HTTP agent itself calls. Nothing reaches a socket without passing it,
// and every redirect repeats the whole procedure.

import { lookup as dnsLookup } from 'node:dns';
import { isIP, isIPv4 } from 'node:net';
import { AppError } from './errors.js';
import type { DestinationPolicy } from './types.js';

export type AddressScope =
  | 'global'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'unique-local'
  | 'multicast'
  | 'unspecified'
  | 'reserved'
  | 'metadata';

export interface ClassifiedAddress {
  readonly address: string;
  readonly family: 4 | 6;
  readonly scope: AddressScope;
}

/**
 * Cloud instance metadata services. These are ordinary link-local or private
 * addresses, but they are named separately because a request that reaches one
 * is the single most valuable result of a server-side request forgery.
 */
const METADATA_ADDRESSES = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254',
]);

function parseIPv4(address: string): readonly number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function classifyIPv4(address: string): AddressScope {
  if (METADATA_ADDRESSES.has(address)) return 'metadata';
  const octets = parseIPv4(address);
  if (octets === null) return 'reserved';
  const [a = 0, b = 0] = octets;
  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // carrier-grade NAT
  if (a === 192 && b === 0) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved'; // benchmarking
  if (a === 192 && b === 88) return 'reserved';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return 'global';
}

/** Expand an IPv6 address to its eight 16-bit groups. */
function expandIPv6(address: string): readonly number[] | null {
  const zoneless = address.split('%')[0] ?? address;
  const [head = '', tail] = zoneless.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups: number[] = [];

  const parse = (items: readonly string[]): boolean => {
    for (const item of items) {
      if (isIPv4(item)) {
        const octets = parseIPv4(item);
        if (octets === null) return false;
        groups.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0));
        groups.push(((octets[2] ?? 0) << 8) | (octets[3] ?? 0));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(item)) return false;
      groups.push(Number.parseInt(item, 16));
    }
    return true;
  };

  // A dotted-quad item contributes two groups, not one, so the filler is
  // counted in groups rather than in items.
  const width = (items: readonly string[]): number =>
    items.reduce((total, item) => total + (isIPv4(item) ? 2 : 1), 0);

  if (!parse(headGroups)) return null;
  if (tail !== undefined) {
    const filler = 8 - width(headGroups) - width(tailGroups);
    if (filler < 0) return null;
    for (let i = 0; i < filler; i += 1) groups.push(0);
  }
  if (!parse(tailGroups)) return null;
  return groups.length === 8 ? groups : null;
}

function classifyIPv6(address: string): AddressScope {
  const normalised = (address.split('%')[0] ?? address).toLowerCase();
  if (METADATA_ADDRESSES.has(normalised)) return 'metadata';
  const groups = expandIPv6(normalised);
  if (groups === null) return 'reserved';
  const [g0 = 0, g1 = 0] = groups;

  if (groups.every((g) => g === 0)) return 'unspecified';
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) {
    return 'loopback';
  }
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible addresses are judged by
  // the IPv4 address they carry, so ::ffff:127.0.0.1 is loopback.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return classifyIPv4(ipv4FromGroups(groups));
  }
  if (groups.slice(0, 6).every((g) => g === 0) && (groups[6] ?? 0) !== 0) {
    return classifyIPv4(ipv4FromGroups(groups));
  }
  // NAT64 (64:ff9b::/96) carries an embedded IPv4 destination.
  if (g0 === 0x0064 && g1 === 0xff9b) {
    return classifyIPv4(ipv4FromGroups(groups));
  }
  if ((g0 & 0xff00) === 0xff00) return 'multicast';
  if ((g0 & 0xffc0) === 0xfe80) return 'link-local';
  if ((g0 & 0xfe00) === 0xfc00) return 'unique-local';
  if (g0 === 0x2002) return 'reserved'; // 6to4
  if (g0 === 0x2001 && g1 === 0x0000) return 'reserved'; // Teredo
  if (g0 === 0x2001 && g1 === 0x0db8) return 'reserved'; // documentation
  return 'global';
}

function ipv4FromGroups(groups: readonly number[]): string {
  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

export function classifyAddress(address: string): ClassifiedAddress {
  const version = isIP(address);
  if (version === 4) {
    return { address, family: 4, scope: classifyIPv4(address) };
  }
  if (version === 6) {
    return { address, family: 6, scope: classifyIPv6(address) };
  }
  // Not an address at all. Treated as reserved so that a caller which
  // mistakenly passes a name never gets a permissive answer.
  return { address, family: 4, scope: 'reserved' };
}

export function isGloballyRoutable(address: string): boolean {
  return classifyAddress(address).scope === 'global';
}

const SCOPE_DESCRIPTION: Record<AddressScope, string> = {
  global: 'globally routable',
  loopback: 'a loopback address',
  private: 'a private network address',
  'link-local': 'a link-local address',
  'unique-local': 'a unique-local address',
  multicast: 'a multicast address',
  unspecified: 'an unspecified address',
  reserved: 'a reserved address',
  metadata: 'a cloud instance metadata address',
};

export function describeScope(scope: AddressScope): string {
  return SCOPE_DESCRIPTION[scope];
}

/** Refuse anything the policy does not allow, with a specific reason. */
export function assertAllowed(
  resolved: ClassifiedAddress,
  host: string,
  policy: DestinationPolicy,
): void {
  if (policy.allowPrivate || resolved.scope === 'global') return;
  const where =
    host === resolved.address
      ? `${host} is ${describeScope(resolved.scope)}`
      : `${host} resolves to ${resolved.address}, which is ` +
        describeScope(resolved.scope);
  throw new AppError(
    'destination-refused',
    `${where}, and destination restrictions are in force.`,
    'Remove --restrict-destinations to allow requests to this network.',
  );
}

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Build the `lookup` function passed to `http.request`.
 *
 * Returning only approved addresses is what makes this a connection-boundary
 * check rather than a pre-flight one: the agent connects to exactly the
 * address this function returned, so there is no window in which a second
 * resolution could return something else.
 */
export function createGuardedLookup(
  policy: DestinationPolicy,
  resolver: typeof dnsLookup = dnsLookup,
): (
  hostname: string,
  options: unknown,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void,
) => void {
  return (hostname, _options, callback) => {
    // Every address is checked, so the order only affects which one is tried
    // first. `verbatim` keeps the resolver's own order.
    resolver(hostname, { all: true, order: 'verbatim' }, (err, addresses) => {
      if (err) {
        callback(err, '', undefined);
        return;
      }
      const entries = Array.isArray(addresses) ? addresses : [];
      if (entries.length === 0) {
        callback(
          new AppError('dns-failure', `${hostname} did not resolve.`),
          '',
          undefined,
        );
        return;
      }
      for (const entry of entries) {
        const classified = classifyAddress(entry.address);
        try {
          assertAllowed(classified, hostname, policy);
        } catch (error) {
          callback(error as NodeJS.ErrnoException, '', undefined);
          return;
        }
      }
      callback(
        null,
        entries.map((entry) => ({
          address: entry.address,
          family: entry.family,
        })),
      );
    });
  };
}
