// JSON output.

import { describe, expect, it } from 'vitest';
import { compareExchanges } from '../../../src/core/compare.js';
import { REDACTED } from '../../../src/core/redact.js';
import {
  comparisonToJson,
  envelope,
  exchangeToJson,
  round,
  SCHEMA_VERSION,
} from '../../../src/output/json.js';
import { makeExchange, makeHop } from '../helpers/exchange.js';

describe('envelope', () => {
  it('states the schema, the tool, the version and the status', () => {
    const wrapped = envelope('send', '1.2.3', 'ok', { a: 1 });
    expect(wrapped.schemaVersion).toBe(SCHEMA_VERSION);
    expect(wrapped.tool).toBe('requestlab');
    expect(wrapped.version).toBe('1.2.3');
    expect(wrapped.command).toBe('send');
    expect(wrapped.status).toBe('ok');
    expect(wrapped.result).toEqual({ a: 1 });
    expect(Date.parse(wrapped.generatedAt)).not.toBeNaN();
  });

  it('survives a round trip through JSON', () => {
    const wrapped = envelope('compare', '1.0.0', 'different', []);
    expect(JSON.parse(JSON.stringify(wrapped))).toEqual(wrapped);
  });
});

describe('round', () => {
  it('keeps three decimal places', () => {
    expect(round(1.23456)).toBe(1.235);
    expect(round(10)).toBe(10);
  });
});

describe('exchangeToJson', () => {
  it('lower-cases and redacts the header objects', () => {
    const json = exchangeToJson(
      makeExchange({
        request: {
          headers: [
            { name: 'Authorization', value: 'Bearer abcdefghijkl' },
            { name: 'Accept', value: '*/*' },
          ],
        },
        final: {
          headers: [
            { name: 'Set-Cookie', value: 'a=b' },
            { name: 'Set-Cookie', value: 'c=d' },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
      }),
      false,
    );
    const request = json['request'] as Record<string, unknown>;
    const response = json['response'] as Record<string, unknown>;
    expect(request['headers']).toEqual({
      authorization: [REDACTED],
      accept: ['*/*'],
    });
    expect(response['headers']).toEqual({
      'set-cookie': [REDACTED, REDACTED],
      'content-type': ['application/json'],
    });
  });

  it('reports the declared content type and length', () => {
    const json = exchangeToJson(makeExchange(), false);
    const response = json['response'] as Record<string, unknown>;
    expect(response['status']).toBe(200);
    expect(response['statusText']).toBe('OK');
    expect(response['httpVersion']).toBe('1.1');
    expect(response['contentType']).toBe('application/json');
    expect(response['contentLength']).toBe(12);
  });

  it('reports a missing content type and length as null', () => {
    const json = exchangeToJson(
      makeExchange({ final: { headers: [] } }),
      false,
    );
    const response = json['response'] as Record<string, unknown>;
    expect(response['contentType']).toBeNull();
    expect(response['contentLength']).toBeNull();
  });

  it('redacts the URLs and omits the preview unless asked', () => {
    const exchange = makeExchange({
      request: { url: 'https://example.com/?api_key=secret' },
      final: { url: 'https://user:pass@example.com/' },
      body: { preview: 'Bearer abcdefghijkl' },
    });
    const without = exchangeToJson(exchange, false);
    const body = without['body'] as Record<string, unknown>;
    expect(body['preview']).toBeNull();
    expect(JSON.stringify(without)).not.toContain('secret');
    expect(JSON.stringify(without)).not.toContain('pass');

    const withPreview = exchangeToJson(exchange, true);
    const previewed = withPreview['body'] as Record<string, unknown>;
    expect(previewed['preview']).toBe(`Bearer ${REDACTED}`);
  });

  it('summarises the redirect chain and rounds the timings', () => {
    const json = exchangeToJson(
      makeExchange({
        redirects: [
          makeHop({
            status: 302,
            url: 'https://example.com/a?token=abcdef',
            location: 'https://example.com/b',
            headersMs: 1.23456,
          }),
        ],
        timing: { totalMs: 120.98765, redirectMs: 4.5 },
      }),
      false,
    );
    expect(json['redirects']).toEqual([
      {
        url: 'https://example.com/a?token=%5Bredacted%5D',
        method: 'GET',
        status: 302,
        location: 'https://example.com/b',
        headersMs: 1.235,
      },
    ]);
    expect(json['timing']).toEqual({
      totalMs: 120.988,
      headersMs: 40,
      bodyMs: 20,
      redirectMs: 4.5,
    });
    expect(json['startedAt']).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('comparisonToJson', () => {
  it('carries the verdict, the differences and both summaries', () => {
    const left = makeExchange();
    const right = makeExchange({
      final: { status: 404, statusText: 'Not Found' },
      timing: { totalMs: 200.4444 },
    });
    const json = comparisonToJson(compareExchanges(left, right), left, right);
    expect(json['identical']).toBe(false);
    expect(json['differences']).toEqual([
      {
        kind: 'status',
        field: 'status',
        left: '200 OK',
        right: '404 Not Found',
      },
    ]);
    expect(json['ignoredHeaders']).toContain('date');
    expect(json['timing']).toEqual({
      leftMs: 120,
      rightMs: 200.444,
      deltaMs: 80.444,
      note: 'Timing differences may reflect network variability.',
    });
    expect(json['right']).toEqual({
      url: 'https://example.com/',
      finalUrl: 'https://example.com/',
      status: 404,
      bytes: 12,
      sha256: 'a'.repeat(64),
      redirects: 0,
    });
  });

  it('redacts the summarised URLs', () => {
    const left = makeExchange({
      request: { url: 'https://example.com/?password=hunter2' },
    });
    const right = makeExchange();
    const json = comparisonToJson(compareExchanges(left, right), left, right);
    expect(JSON.stringify(json)).not.toContain('hunter2');
  });
});
