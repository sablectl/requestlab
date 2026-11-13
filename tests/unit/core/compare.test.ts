// Response comparison.

import { describe, expect, it } from 'vitest';
import {
  compareExchanges,
  DEFAULT_VOLATILE_HEADERS,
} from '../../../src/core/compare.js';
import { makeExchange, makeHop } from '../helpers/exchange.js';

describe('compareExchanges', () => {
  it('reports no differences for two identical responses', () => {
    const comparison = compareExchanges(makeExchange(), makeExchange());
    expect(comparison.differences).toEqual([]);
    expect(comparison.identical).toBe(true);
  });

  it('reports a differing status', () => {
    const comparison = compareExchanges(
      makeExchange(),
      makeExchange({ final: { status: 404, statusText: 'Not Found' } }),
    );
    expect(comparison.identical).toBe(false);
    expect(comparison.differences).toEqual([
      {
        kind: 'status',
        field: 'status',
        left: '200 OK',
        right: '404 Not Found',
      },
    ]);
  });

  it('reports a differing header value', () => {
    const comparison = compareExchanges(
      makeExchange({
        final: { headers: [{ name: 'X-Flavour', value: 'vanilla' }] },
      }),
      makeExchange({
        final: { headers: [{ name: 'x-flavour', value: 'chocolate' }] },
      }),
    );
    expect(comparison.differences).toEqual([
      {
        kind: 'header',
        field: 'x-flavour',
        left: 'vanilla',
        right: 'chocolate',
      },
    ]);
  });

  it('reports a header absent on one side', () => {
    const comparison = compareExchanges(
      makeExchange({
        final: { headers: [{ name: 'X-Extra', value: 'yes' }] },
      }),
      makeExchange({ final: { headers: [] } }),
    );
    expect(comparison.differences).toEqual([
      { kind: 'header', field: 'x-extra', left: 'yes', right: '(absent)' },
    ]);
  });

  it('joins repeated headers before comparing them', () => {
    const comparison = compareExchanges(
      makeExchange({
        final: {
          headers: [
            { name: 'Vary', value: 'accept' },
            { name: 'Vary', value: 'origin' },
          ],
        },
      }),
      makeExchange({
        final: { headers: [{ name: 'Vary', value: 'accept, origin' }] },
      }),
    );
    expect(comparison.identical).toBe(true);
  });

  it('reports size and digest differences', () => {
    const comparison = compareExchanges(
      makeExchange(),
      makeExchange({ body: { bytes: 20, sha256: 'b'.repeat(64) } }),
    );
    expect(comparison.differences).toEqual([
      {
        kind: 'size',
        field: 'body size',
        left: '12 bytes',
        right: '20 bytes',
      },
      {
        kind: 'digest',
        field: 'body sha256',
        left: 'a'.repeat(64),
        right: 'b'.repeat(64),
      },
    ]);
  });

  it('reports a differing final URL and redirect count', () => {
    const comparison = compareExchanges(
      makeExchange(),
      makeExchange({
        redirects: [makeHop({ status: 301, location: 'https://example.com/' })],
        final: { url: 'https://example.com/moved' },
      }),
    );
    expect(comparison.differences).toEqual([
      {
        kind: 'final-url',
        field: 'final URL',
        left: 'https://example.com/',
        right: 'https://example.com/moved',
      },
      { kind: 'redirects', field: 'redirects', left: '0', right: '1' },
    ]);
  });

  it('ignores the volatile headers by default', () => {
    const comparison = compareExchanges(
      makeExchange({
        final: { headers: [{ name: 'Date', value: 'Mon, 1 Jan 2026' }] },
      }),
      makeExchange({
        final: { headers: [{ name: 'Date', value: 'Tue, 2 Jan 2026' }] },
      }),
    );
    expect(comparison.identical).toBe(true);
    expect(comparison.ignoredHeaders).toEqual(
      [...DEFAULT_VOLATILE_HEADERS].sort(),
    );
  });

  it('compares the volatile headers when the default list is off', () => {
    const comparison = compareExchanges(
      makeExchange({
        final: { headers: [{ name: 'Date', value: 'Mon, 1 Jan 2026' }] },
      }),
      makeExchange({
        final: { headers: [{ name: 'Date', value: 'Tue, 2 Jan 2026' }] },
      }),
      { ignoreVolatile: false },
    );
    expect(comparison.ignoredHeaders).toEqual([]);
    expect(comparison.differences).toEqual([
      {
        kind: 'header',
        field: 'date',
        left: 'Mon, 1 Jan 2026',
        right: 'Tue, 2 Jan 2026',
      },
    ]);
  });

  it('honours an extra ignore list, lower-cased', () => {
    const comparison = compareExchanges(
      makeExchange({
        final: { headers: [{ name: 'X-Build', value: '1' }] },
      }),
      makeExchange({
        final: { headers: [{ name: 'X-Build', value: '2' }] },
      }),
      { ignoreHeaders: ['X-Build'] },
    );
    expect(comparison.identical).toBe(true);
    expect(comparison.ignoredHeaders).toContain('x-build');
  });

  it('compares only the named headers when onlyHeaders is given', () => {
    const left = makeExchange({
      final: {
        headers: [
          { name: 'X-Watched', value: 'one' },
          { name: 'X-Other', value: 'left' },
        ],
      },
    });
    const right = makeExchange({
      final: {
        headers: [
          { name: 'X-Watched', value: 'two' },
          { name: 'X-Other', value: 'right' },
        ],
      },
    });
    const comparison = compareExchanges(left, right, {
      onlyHeaders: ['X-Watched'],
    });
    expect(comparison.differences).toEqual([
      { kind: 'header', field: 'x-watched', left: 'one', right: 'two' },
    ]);
  });

  it('skips body size and digest when the body is not compared', () => {
    const comparison = compareExchanges(
      makeExchange(),
      makeExchange({ body: { bytes: 20, sha256: 'b'.repeat(64) } }),
      { compareBody: false },
    );
    expect(comparison.identical).toBe(true);
  });

  it('reports timing without ever counting it as a difference', () => {
    const comparison = compareExchanges(
      makeExchange({ timing: { totalMs: 100 } }),
      makeExchange({ timing: { totalMs: 450 } }),
    );
    expect(comparison.identical).toBe(true);
    expect(comparison.timing).toEqual({
      leftMs: 100,
      rightMs: 450,
      deltaMs: 350,
    });
  });
});
