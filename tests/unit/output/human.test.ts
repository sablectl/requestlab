// Human-readable output.

import { describe, expect, it } from 'vitest';
import { compareExchanges } from '../../../src/core/compare.js';
import type { HistoryEntry } from '../../../src/core/history.js';
import { REDACTED } from '../../../src/core/redact.js';
import { createPainter } from '../../../src/output/colour.js';
import {
  formatBytes,
  formatComparison,
  formatHistory,
  formatInspect,
  formatMs,
  formatSend,
  type ReportOptions,
} from '../../../src/output/human.js';
import { makeExchange, makeHop } from '../helpers/exchange.js';

const paint = createPainter(false);

const ALL: ReportOptions = {
  showRequestHeaders: true,
  showResponseHeaders: true,
  showBody: true,
};

const NONE: ReportOptions = {
  showRequestHeaders: false,
  showResponseHeaders: false,
  showBody: false,
};

describe('formatBytes', () => {
  it('reports small sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('reports larger sizes in binary multiples', () => {
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MiB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GiB');
  });
});

describe('formatMs', () => {
  it('rounds milliseconds below a second', () => {
    expect(formatMs(0)).toBe('0 ms');
    expect(formatMs(12.4)).toBe('12 ms');
    expect(formatMs(999)).toBe('999 ms');
  });

  it('switches to seconds at a second', () => {
    expect(formatMs(1000)).toBe('1.00 s');
    expect(formatMs(1500)).toBe('1.50 s');
  });
});

describe('formatSend', () => {
  it('reports the status, size and total time', () => {
    const lines = formatSend(makeExchange(), paint, NONE).split('\n');
    expect(lines[0]).toBe('HTTP/1.1 200 OK');
    expect(lines).toContain('Summary');
    expect(lines).toContain(`  ${'Size'.padEnd(15)} 12 B`);
    expect(lines).toContain(`  ${'Total'.padEnd(15)} 120 ms`);
  });

  it('omits the status text when there is none', () => {
    const output = formatSend(
      makeExchange({ final: { statusText: '' } }),
      paint,
      NONE,
    );
    expect(output.split('\n')[0]).toBe('HTTP/1.1 200');
  });

  it('shows the request and response headers when asked, redacted', () => {
    const output = formatSend(
      makeExchange({
        request: {
          url: 'https://example.com/?token=abcdef',
          headers: [{ name: 'Authorization', value: 'Bearer abcdefghijkl' }],
        },
        final: { headers: [{ name: 'Cookie', value: 'a=b' }] },
      }),
      paint,
      ALL,
    );
    expect(output).toContain('Request');
    expect(output).toContain(`  Authorization: ${REDACTED}`);
    expect(output).toContain('Response headers');
    expect(output).toContain(`  Cookie: ${REDACTED}`);
    expect(output).not.toContain('abcdef');
  });

  it('lists the redirect chain and the final URL', () => {
    const output = formatSend(
      makeExchange({
        redirects: [
          makeHop({
            status: 301,
            url: 'https://example.com/old',
            location: 'https://example.com/new',
          }),
        ],
        final: { url: 'https://example.com/new' },
      }),
      paint,
      NONE,
    );
    expect(output).toContain(
      '  301 https://example.com/old → https://example.com/new',
    );
    expect(output).toContain(
      `  ${'Final URL'.padEnd(15)} https://example.com/new`,
    );
  });

  it('redacts the body preview and notes truncation', () => {
    const output = formatSend(
      makeExchange({
        body: {
          preview: 'Authorization: Bearer abcdefghijkl',
          previewTruncated: true,
          truncated: true,
        },
      }),
      paint,
      ALL,
    );
    expect(output).toContain(`Authorization: Bearer ${REDACTED}`);
    expect(output).toContain(
      '… preview truncated. Use --preview to show more.',
    );
    expect(output).toContain('12 B (truncated at the size limit)');
  });

  it('says why a binary body is not shown', () => {
    const output = formatSend(
      makeExchange({ body: { preview: null, encoding: 'binary' } }),
      paint,
      ALL,
    );
    expect(output).toContain('Body not shown: 12 B of binary content.');
  });
});

describe('formatInspect', () => {
  it('reports every measured field', () => {
    const output = formatInspect(
      makeExchange({
        request: { bodyBytes: 7, bodySource: 'text' },
        timing: { totalMs: 120, headersMs: 40, bodyMs: 20, redirectMs: 15 },
      }),
      paint,
    );
    const field = (label: string, value: string): string =>
      `  ${label.padEnd(15)} ${value}`;
    expect(output).toContain(field('Method', 'GET'));
    expect(output).toContain(field('URL', 'https://example.com/'));
    expect(output).toContain(field('Body', '7 B from text'));
    expect(output).toContain(field('Status', '200 OK'));
    expect(output).toContain(field('Content type', 'application/json'));
    expect(output).toContain(field('Content length', '12 declared'));
    expect(output).toContain(field('Received', '12 B'));
    expect(output).toContain(field('SHA-256', 'a'.repeat(64)));
    expect(output).toContain(field('Peer', '93.184.216.34 port 443 (IPv4)'));
    expect(output).toContain(field('TLS', 'not used (plain HTTP)'));
    expect(output).toContain(field('Total', '120 ms'));
    expect(output).toContain(field('To headers', '40 ms'));
    expect(output).toContain(field('Body transfer', '20 ms'));
    expect(output).toContain(field('Redirects', '15 ms'));
  });

  it('says when nothing was declared or measured', () => {
    const output = formatInspect(
      makeExchange({ final: { headers: [], remote: null } }),
      paint,
    );
    expect(output).toContain('Content type    not declared');
    expect(output).toContain(
      'Content length  not declared (chunked or unknown)',
    );
    expect(output).toContain('Peer            not available');
    expect(output).toContain('Redirects       none');
  });

  it('reports the TLS details when the connection used TLS', () => {
    const output = formatInspect(
      makeExchange({
        final: {
          tls: {
            protocol: 'TLSv1.3',
            cipher: 'TLS_AES_256_GCM_SHA384',
            subject: 'CN=example.com',
            issuer: 'CN=Test CA',
            validFrom: '2026-01-01',
            validTo: '2027-01-01',
            subjectAltName: 'DNS:example.com',
            authorized: true,
          },
        },
      }),
      paint,
    );
    expect(output).toContain('TLS             TLSv1.3');
    expect(output).toContain('Cipher          TLS_AES_256_GCM_SHA384');
    expect(output).toContain('Verified        yes');
    expect(output).toContain('Valid           2026-01-01 to 2027-01-01');
  });

  it('numbers the redirect chain', () => {
    const output = formatInspect(
      makeExchange({
        redirects: [
          makeHop({
            status: 302,
            url: 'https://example.com/a',
            location: 'https://example.com/b',
            headersMs: 5,
          }),
        ],
      }),
      paint,
    );
    expect(output).toContain('  1. 302 GET https://example.com/a');
    expect(output).toContain('     → https://example.com/b in 5 ms');
  });
});

describe('formatComparison', () => {
  it('announces an identical pair', () => {
    const left = makeExchange();
    const right = makeExchange();
    const output = formatComparison(
      compareExchanges(left, right),
      left,
      right,
      paint,
    );
    expect(output).toContain('IDENTICAL');
    expect(output).toContain('  No differences outside the ignored headers.');
    expect(output).toContain('Ignored headers: age, alt-svc');
  });

  it('lists each difference with both sides', () => {
    const left = makeExchange();
    const right = makeExchange({
      final: { status: 500, statusText: 'Server Error' },
      timing: { totalMs: 60 },
    });
    const output = formatComparison(
      compareExchanges(left, right),
      left,
      right,
      paint,
    );
    expect(output).toContain('1 difference');
    expect(output).toContain('  status');
    expect(output).toContain('    left   200 OK');
    expect(output).toContain('    right  500 Server Error');
    expect(output).toContain(`  ${'Difference'.padEnd(15)} −60 ms`);
  });

  it('redacts the compared URLs', () => {
    const left = makeExchange({
      request: { url: 'https://example.com/?api_key=secret' },
    });
    const right = makeExchange();
    const output = formatComparison(
      compareExchanges(left, right),
      left,
      right,
      paint,
    );
    expect(output).not.toContain('secret');
  });
});

describe('formatHistory', () => {
  const entry: HistoryEntry = {
    at: '2026-01-01T00:00:00.000Z',
    method: 'GET',
    url: 'https://example.com/',
    status: 200,
    statusText: 'OK',
    finalUrl: 'https://example.com/',
    redirects: 0,
    requestHeaders: [],
    responseHeaders: [],
    requestBodyBytes: 0,
    responseBodyBytes: 12,
    responseSha256: null,
    totalMs: 10,
    error: null,
  };

  it('says so when there is nothing recorded', () => {
    expect(formatHistory([], paint)).toBe('No history recorded.');
  });

  it('lists one entry and counts it in the singular', () => {
    const output = formatHistory([entry], paint);
    expect(output).toContain(
      '2026-01-01T00:00:00.000Z  200  GET https://example.com/',
    );
    expect(output).toContain('1 entry.');
  });

  it('marks a failed entry and shows its message', () => {
    const output = formatHistory(
      [entry, { ...entry, status: null, error: 'The connection failed.' }],
      paint,
    );
    expect(output).toContain('failed  GET https://example.com/');
    expect(output).toContain('    The connection failed.');
    expect(output).toContain('2 entries.');
  });
});
