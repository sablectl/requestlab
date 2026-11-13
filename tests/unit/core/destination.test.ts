// Address classification and the connection-boundary guard.

import { describe, expect, it } from 'vitest';
import {
  assertAllowed,
  classifyAddress,
  createGuardedLookup,
  describeScope,
  isGloballyRoutable,
} from '../../../src/core/destination.js';
import { AppError } from '../../../src/core/errors.js';
import type { DestinationPolicy } from '../../../src/core/types.js';

const RESTRICTED: DestinationPolicy = { allowPrivate: false };
const PERMISSIVE: DestinationPolicy = { allowPrivate: true };

/** A `dns.lookup`-shaped resolver that answers from a fixed table. */
function fakeResolver(
  answers: readonly { address: string; family: number }[],
): Parameters<typeof createGuardedLookup>[1] {
  const resolver = (
    _hostname: string,
    _options: unknown,
    callback: (
      err: NodeJS.ErrnoException | null,
      addresses: { address: string; family: number }[],
    ) => void,
  ): void => {
    callback(null, [...answers]);
  };
  return resolver as unknown as Parameters<typeof createGuardedLookup>[1];
}

function lookupOnce(
  lookup: ReturnType<typeof createGuardedLookup>,
  hostname: string,
): Promise<{
  error: NodeJS.ErrnoException | null;
  address: string | { address: string; family: number }[];
}> {
  return new Promise((resolve) => {
    lookup(hostname, { all: true }, (error, address) => {
      resolve({ error, address });
    });
  });
}

describe('classifyAddress', () => {
  it('classifies IPv4 addresses', () => {
    expect(classifyAddress('127.0.0.1').scope).toBe('loopback');
    expect(classifyAddress('127.9.9.9').scope).toBe('loopback');
    expect(classifyAddress('10.0.0.1').scope).toBe('private');
    expect(classifyAddress('172.16.0.1').scope).toBe('private');
    expect(classifyAddress('172.31.255.255').scope).toBe('private');
    expect(classifyAddress('172.32.0.1').scope).toBe('global');
    expect(classifyAddress('192.168.1.1').scope).toBe('private');
    expect(classifyAddress('100.64.0.1').scope).toBe('private');
    expect(classifyAddress('169.254.1.1').scope).toBe('link-local');
    expect(classifyAddress('224.0.0.1').scope).toBe('multicast');
    expect(classifyAddress('0.0.0.0').scope).toBe('unspecified');
    expect(classifyAddress('240.0.0.1').scope).toBe('reserved');
    expect(classifyAddress('198.18.0.1').scope).toBe('reserved');
    expect(classifyAddress('93.184.216.34').scope).toBe('global');
  });

  it('reports the family of each address', () => {
    expect(classifyAddress('93.184.216.34').family).toBe(4);
    expect(classifyAddress('2606:2800:220:1::1').family).toBe(6);
  });

  it('names cloud metadata addresses specially', () => {
    expect(classifyAddress('169.254.169.254').scope).toBe('metadata');
    expect(classifyAddress('100.100.100.200').scope).toBe('metadata');
    expect(classifyAddress('fd00:ec2::254').scope).toBe('metadata');
  });

  it('classifies IPv6 addresses', () => {
    expect(classifyAddress('::1').scope).toBe('loopback');
    expect(classifyAddress('::').scope).toBe('unspecified');
    expect(classifyAddress('fe80::1').scope).toBe('link-local');
    expect(classifyAddress('fc00::1').scope).toBe('unique-local');
    expect(classifyAddress('fd12:3456::1').scope).toBe('unique-local');
    expect(classifyAddress('ff02::1').scope).toBe('multicast');
    expect(classifyAddress('2001:db8::1').scope).toBe('reserved');
    expect(classifyAddress('2002::1').scope).toBe('reserved');
    expect(classifyAddress('2606:2800:220:1::1').scope).toBe('global');
  });

  it('judges mapped and translated addresses by the IPv4 they carry', () => {
    expect(classifyAddress('::ffff:7f00:1').scope).toBe('loopback');
    expect(classifyAddress('::ffff:5db8:d822').scope).toBe('global');
    expect(classifyAddress('64:ff9b::7f00:1').scope).toBe('loopback');
    expect(classifyAddress('64:ff9b::a00:1').scope).toBe('private');
  });

  it('expands a dotted-quad tail after "::"', () => {
    expect(classifyAddress('::ffff:127.0.0.1').scope).toBe('loopback');
    expect(classifyAddress('::127.0.0.1').scope).toBe('loopback');
    expect(classifyAddress('64:ff9b::127.0.0.1').scope).toBe('loopback');
    expect(classifyAddress('::ffff:10.0.0.1').scope).toBe('private');
    expect(classifyAddress('64:ff9b::10.0.0.1').scope).toBe('private');
    expect(classifyAddress('::ffff:93.184.216.34').scope).toBe('global');
  });

  it('ignores a zone identifier', () => {
    expect(classifyAddress('fe80::1%eth0').scope).toBe('link-local');
  });

  it('treats anything that is not an address as reserved', () => {
    const classified = classifyAddress('example.com');
    expect(classified.scope).toBe('reserved');
    expect(classified.family).toBe(4);
  });
});

describe('isGloballyRoutable', () => {
  it('is true only for global addresses', () => {
    expect(isGloballyRoutable('93.184.216.34')).toBe(true);
    expect(isGloballyRoutable('2606:2800:220:1::1')).toBe(true);
    expect(isGloballyRoutable('127.0.0.1')).toBe(false);
    expect(isGloballyRoutable('::1')).toBe(false);
  });
});

describe('describeScope', () => {
  it('describes every scope in words', () => {
    expect(describeScope('global')).toBe('globally routable');
    expect(describeScope('metadata')).toBe('a cloud instance metadata address');
  });
});

describe('assertAllowed', () => {
  it('allows everything when private addresses are permitted', () => {
    for (const address of ['127.0.0.1', '::1', '169.254.169.254']) {
      expect(() => {
        assertAllowed(classifyAddress(address), address, PERMISSIVE);
      }).not.toThrow();
    }
  });

  it('allows a global address under restrictions', () => {
    expect(() => {
      assertAllowed(
        classifyAddress('93.184.216.34'),
        'example.com',
        RESTRICTED,
      );
    }).not.toThrow();
  });

  it('refuses a non-global address with a destination-refused error', () => {
    let caught: unknown;
    try {
      assertAllowed(classifyAddress('127.0.0.1'), '127.0.0.1', RESTRICTED);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    const error = caught as AppError;
    expect(error.code).toBe('destination-refused');
    expect(error.message).toBe(
      '127.0.0.1 is a loopback address, and destination restrictions are ' +
        'in force.',
    );
    expect(error.hint).toBe(
      'Remove --restrict-destinations to allow requests to this network.',
    );
  });

  it('names the resolved address when the host is a name', () => {
    expect(() => {
      assertAllowed(classifyAddress('10.0.0.1'), 'internal.test', RESTRICTED);
    }).toThrow(
      /internal\.test resolves to 10\.0\.0\.1, which is a private network/,
    );
  });
});

describe('createGuardedLookup', () => {
  it('passes allowed addresses through', async () => {
    const lookup = createGuardedLookup(
      RESTRICTED,
      fakeResolver([{ address: '93.184.216.34', family: 4 }]),
    );
    const { error, address } = await lookupOnce(lookup, 'example.com');
    expect(error).toBeNull();
    expect(address).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('refuses when any answer is not allowed', async () => {
    const lookup = createGuardedLookup(
      RESTRICTED,
      fakeResolver([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    );
    const { error, address } = await lookupOnce(lookup, 'rebind.test');
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('destination-refused');
    expect(address).toBe('');
  });

  it('allows a refused scope when the policy permits private addresses', async () => {
    const lookup = createGuardedLookup(
      PERMISSIVE,
      fakeResolver([{ address: '127.0.0.1', family: 4 }]),
    );
    const { error, address } = await lookupOnce(lookup, 'localhost');
    expect(error).toBeNull();
    expect(address).toEqual([{ address: '127.0.0.1', family: 4 }]);
  });

  it('errors when resolution returns no addresses', async () => {
    const lookup = createGuardedLookup(PERMISSIVE, fakeResolver([]));
    const { error } = await lookupOnce(lookup, 'nowhere.test');
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('dns-failure');
    expect((error as AppError).message).toBe('nowhere.test did not resolve.');
  });

  it('forwards a resolver failure unchanged', async () => {
    const failure: NodeJS.ErrnoException = new Error('ENOTFOUND');
    const resolver = (
      _hostname: string,
      _options: unknown,
      callback: (err: NodeJS.ErrnoException | null, addresses: []) => void,
    ): void => {
      callback(failure, []);
    };
    const lookup = createGuardedLookup(
      RESTRICTED,
      resolver as unknown as Parameters<typeof createGuardedLookup>[1],
    );
    const { error } = await lookupOnce(lookup, 'broken.test');
    expect(error).toBe(failure);
  });
});
