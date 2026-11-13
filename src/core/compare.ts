// Response comparison.
//
// Two exchanges are reduced to a list of differences. Timing is reported but
// never counts as a difference: two requests over a network are never equally
// fast, and a comparison that fails for that reason would be worthless.

import type { Exchange, HeaderPair } from './types.js';

/** Headers that differ between two identical responses by design. */
export const DEFAULT_VOLATILE_HEADERS: readonly string[] = [
  'age',
  'alt-svc',
  'cf-ray',
  'connection',
  'date',
  'expires',
  'keep-alive',
  'nel',
  'report-to',
  'reporting-endpoints',
  'request-id',
  'server-timing',
  'set-cookie',
  'traceparent',
  'x-amz-cf-id',
  'x-amz-request-id',
  'x-correlation-id',
  'x-request-id',
  'x-runtime',
  'x-served-by',
  'x-timer',
  'x-trace-id',
];

export type DifferenceKind =
  'status' | 'header' | 'size' | 'digest' | 'final-url' | 'redirects';

export interface Difference {
  readonly kind: DifferenceKind;
  /** Header name, or the field name for non-header differences. */
  readonly field: string;
  readonly left: string;
  readonly right: string;
}

export interface TimingDelta {
  readonly leftMs: number;
  readonly rightMs: number;
  readonly deltaMs: number;
}

export interface ComparisonOptions {
  /** Header names to ignore, in addition to the volatile set. */
  readonly ignoreHeaders?: readonly string[];
  /** Compare only these header names, when given. */
  readonly onlyHeaders?: readonly string[];
  /** Include the default volatile header list in the ignored set. */
  readonly ignoreVolatile?: boolean;
  /** Compare the response body digest and size. */
  readonly compareBody?: boolean;
}

export interface Comparison {
  readonly differences: readonly Difference[];
  readonly ignoredHeaders: readonly string[];
  readonly timing: TimingDelta;
  readonly identical: boolean;
}

/** Collapse repeated headers the way a comparison should see them. */
function headerMap(headers: readonly HeaderPair[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const { name, value } of headers) {
    const key = name.toLowerCase();
    const existing = map.get(key);
    map.set(key, existing === undefined ? value : `${existing}, ${value}`);
  }
  return map;
}

export function compareExchanges(
  left: Exchange,
  right: Exchange,
  options: ComparisonOptions = {},
): Comparison {
  const ignoreVolatile = options.ignoreVolatile ?? true;
  const compareBody = options.compareBody ?? true;
  const ignored = new Set<string>(
    (ignoreVolatile ? DEFAULT_VOLATILE_HEADERS : []).concat(
      (options.ignoreHeaders ?? []).map((name) => name.toLowerCase()),
    ),
  );
  const only =
    options.onlyHeaders === undefined
      ? null
      : new Set(options.onlyHeaders.map((name) => name.toLowerCase()));

  const differences: Difference[] = [];

  if (left.final.status !== right.final.status) {
    differences.push({
      kind: 'status',
      field: 'status',
      left: `${left.final.status} ${left.final.statusText}`.trim(),
      right: `${right.final.status} ${right.final.statusText}`.trim(),
    });
  }

  const leftHeaders = headerMap(left.final.headers);
  const rightHeaders = headerMap(right.final.headers);
  const names = [
    ...new Set([...leftHeaders.keys(), ...rightHeaders.keys()]),
  ].sort();
  for (const name of names) {
    if (only !== null ? !only.has(name) : ignored.has(name)) continue;
    const leftValue = leftHeaders.get(name);
    const rightValue = rightHeaders.get(name);
    if (leftValue === rightValue) continue;
    differences.push({
      kind: 'header',
      field: name,
      left: leftValue ?? '(absent)',
      right: rightValue ?? '(absent)',
    });
  }

  if (compareBody) {
    if (left.body.bytes !== right.body.bytes) {
      differences.push({
        kind: 'size',
        field: 'body size',
        left: `${left.body.bytes} bytes`,
        right: `${right.body.bytes} bytes`,
      });
    }
    if (left.body.sha256 !== right.body.sha256) {
      differences.push({
        kind: 'digest',
        field: 'body sha256',
        left: left.body.sha256,
        right: right.body.sha256,
      });
    }
  }

  if (left.final.url !== right.final.url) {
    differences.push({
      kind: 'final-url',
      field: 'final URL',
      left: left.final.url,
      right: right.final.url,
    });
  }

  if (left.redirects.length !== right.redirects.length) {
    differences.push({
      kind: 'redirects',
      field: 'redirects',
      left: String(left.redirects.length),
      right: String(right.redirects.length),
    });
  }

  return {
    differences,
    ignoredHeaders: [...ignored].sort(),
    timing: {
      leftMs: left.timing.totalMs,
      rightMs: right.timing.totalMs,
      deltaMs: right.timing.totalMs - left.timing.totalMs,
    },
    identical: differences.length === 0,
  };
}
