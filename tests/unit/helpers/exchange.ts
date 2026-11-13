// A hand-built `Exchange` fixture, so that comparison and formatting can be
// exercised without a transport.

import type {
  BodyRecord,
  Exchange,
  HeaderPair,
  Hop,
  HttpMethod,
  Timing,
} from '../../../src/core/types.js';

export interface HopOverrides {
  readonly url?: string;
  readonly method?: HttpMethod;
  readonly status?: number;
  readonly statusText?: string;
  readonly httpVersion?: string;
  readonly headers?: readonly HeaderPair[];
  readonly location?: string | null;
  readonly headersMs?: number;
  readonly remote?: Hop['remote'];
  readonly tls?: Hop['tls'];
}

export function makeHop(overrides: HopOverrides = {}): Hop {
  return {
    url: overrides.url ?? 'https://example.com/',
    method: overrides.method ?? 'GET',
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? 'OK',
    httpVersion: overrides.httpVersion ?? '1.1',
    headers: overrides.headers ?? [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Content-Length', value: '12' },
    ],
    location: overrides.location ?? null,
    headersMs: overrides.headersMs ?? 10,
    remote:
      overrides.remote !== undefined
        ? overrides.remote
        : { address: '93.184.216.34', family: 4, port: 443 },
    tls: overrides.tls !== undefined ? overrides.tls : null,
  };
}

export interface ExchangeOverrides {
  readonly request?: Partial<Exchange['request']>;
  readonly redirects?: readonly Hop[];
  readonly final?: HopOverrides;
  readonly body?: Partial<BodyRecord>;
  readonly timing?: Partial<Timing>;
  readonly startedAt?: string;
}

export function makeExchange(overrides: ExchangeOverrides = {}): Exchange {
  return {
    request: {
      method: 'GET',
      url: 'https://example.com/',
      headers: [{ name: 'Accept', value: '*/*' }],
      bodyBytes: 0,
      bodySource: null,
      ...overrides.request,
    },
    redirects: overrides.redirects ?? [],
    final: makeHop(overrides.final),
    body: {
      bytes: 12,
      sha256: 'a'.repeat(64),
      preview: '{"ok":true}',
      previewTruncated: false,
      truncated: false,
      encoding: 'utf-8',
      ...overrides.body,
    },
    timing: {
      totalMs: 120,
      headersMs: 40,
      bodyMs: 20,
      redirectMs: null,
      ...overrides.timing,
    },
    startedAt: overrides.startedAt ?? '2026-01-01T00:00:00.000Z',
  };
}
