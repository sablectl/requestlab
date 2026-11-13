// JSON output.
//
// The envelope is versioned independently of the tool, so a consumer can
// detect a breaking change without matching on the release number. Every
// value here has already passed through redaction.

import type { Comparison } from '../core/compare.js';
import { redactHeaders, redactText, redactUrl } from '../core/redact.js';
import type { Exchange, HeaderPair } from '../core/types.js';

export const SCHEMA_VERSION = 1;

export interface Envelope<T> {
  readonly schemaVersion: number;
  readonly tool: 'requestlab';
  readonly version: string;
  readonly command: string;
  readonly generatedAt: string;
  readonly status: 'ok' | 'failed' | 'different';
  readonly result: T;
}

export function envelope<T>(
  command: string,
  version: string,
  status: Envelope<T>['status'],
  result: T,
): Envelope<T> {
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: 'requestlab',
    version,
    command,
    generatedAt: new Date().toISOString(),
    status,
    result,
  };
}

function headerObject(
  headers: readonly HeaderPair[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { name, value } of redactHeaders(headers)) {
    const key = name.toLowerCase();
    (out[key] ??= []).push(value);
  }
  return out;
}

function headerValue(
  headers: readonly HeaderPair[],
  name: string,
): string | null {
  return headers.find((h) => h.name.toLowerCase() === name)?.value ?? null;
}

export function exchangeToJson(
  exchange: Exchange,
  includeBodyPreview: boolean,
): Record<string, unknown> {
  const contentLength = headerValue(exchange.final.headers, 'content-length');
  return {
    request: {
      method: exchange.request.method,
      url: redactUrl(exchange.request.url),
      headers: headerObject(exchange.request.headers),
      bodyBytes: exchange.request.bodyBytes,
      bodySource: exchange.request.bodySource,
    },
    response: {
      status: exchange.final.status,
      statusText: exchange.final.statusText,
      httpVersion: exchange.final.httpVersion,
      url: redactUrl(exchange.final.url),
      headers: headerObject(exchange.final.headers),
      contentType: headerValue(exchange.final.headers, 'content-type'),
      contentLength: contentLength === null ? null : Number(contentLength),
      remote: exchange.final.remote,
      tls: exchange.final.tls,
    },
    redirects: exchange.redirects.map((hop) => ({
      url: redactUrl(hop.url),
      method: hop.method,
      status: hop.status,
      location: hop.location === null ? null : redactUrl(hop.location),
      headersMs: round(hop.headersMs),
    })),
    body: {
      bytes: exchange.body.bytes,
      sha256: exchange.body.sha256,
      encoding: exchange.body.encoding,
      truncated: exchange.body.truncated,
      previewTruncated: exchange.body.previewTruncated,
      preview:
        includeBodyPreview && exchange.body.preview !== null
          ? redactText(exchange.body.preview)
          : null,
    },
    timing: {
      totalMs: round(exchange.timing.totalMs),
      headersMs: round(exchange.timing.headersMs),
      bodyMs: round(exchange.timing.bodyMs),
      redirectMs:
        exchange.timing.redirectMs === null
          ? null
          : round(exchange.timing.redirectMs),
    },
    startedAt: exchange.startedAt,
  };
}

export function comparisonToJson(
  comparison: Comparison,
  left: Exchange,
  right: Exchange,
): Record<string, unknown> {
  return {
    identical: comparison.identical,
    differences: comparison.differences,
    ignoredHeaders: comparison.ignoredHeaders,
    timing: {
      leftMs: round(comparison.timing.leftMs),
      rightMs: round(comparison.timing.rightMs),
      deltaMs: round(comparison.timing.deltaMs),
      note: 'Timing differences may reflect network variability.',
    },
    left: summarise(left),
    right: summarise(right),
  };
}

function summarise(exchange: Exchange): Record<string, unknown> {
  return {
    url: redactUrl(exchange.request.url),
    finalUrl: redactUrl(exchange.final.url),
    status: exchange.final.status,
    bytes: exchange.body.bytes,
    sha256: exchange.body.sha256,
    redirects: exchange.redirects.length,
  };
}

/** Milliseconds to three decimal places; the clock has no more to give. */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
