// Human-readable output.
//
// Formatters return strings. Nothing here writes to a stream, so every line
// this tool can print is reachable from a test.

import type { Comparison } from '../core/compare.js';
import type { HistoryEntry } from '../core/history.js';
import { redactHeaders, redactText, redactUrl } from '../core/redact.js';
import type { Exchange, HeaderPair } from '../core/types.js';
import type { Painter, Style } from './colour.js';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'B'}`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function statusStyle(status: number): Style {
  if (status >= 500) return 'red';
  if (status >= 400) return 'yellow';
  if (status >= 300) return 'cyan';
  return 'green';
}

function statusLine(exchange: Exchange, paint: Painter): string {
  const { status, statusText, httpVersion } = exchange.final;
  const text = `HTTP/${httpVersion} ${status}${
    statusText === '' ? '' : ` ${statusText}`
  }`;
  return paint(text, statusStyle(status));
}

function headerBlock(
  headers: readonly HeaderPair[],
  paint: Painter,
  indent = '  ',
): string[] {
  return redactHeaders(headers).map(
    ({ name, value }) => `${indent}${paint(name, 'dim')}: ${value}`,
  );
}

function field(label: string, value: string, paint: Painter): string {
  return `  ${paint(label.padEnd(15), 'dim')} ${value}`;
}

export interface ReportOptions {
  readonly showRequestHeaders: boolean;
  readonly showResponseHeaders: boolean;
  readonly showBody: boolean;
}

/** The `send` summary: what happened, in as few lines as carry the facts. */
export function formatSend(
  exchange: Exchange,
  paint: Painter,
  options: ReportOptions,
): string {
  const lines: string[] = [statusLine(exchange, paint)];

  if (options.showRequestHeaders) {
    lines.push('', paint('Request', 'bold'));
    lines.push(
      field(
        'Method',
        `${exchange.request.method} ${redactUrl(exchange.request.url)}`,
        paint,
      ),
    );
    lines.push(...headerBlock(exchange.request.headers, paint));
  }

  if (options.showResponseHeaders) {
    lines.push('', paint('Response headers', 'bold'));
    lines.push(...headerBlock(exchange.final.headers, paint));
  }

  if (exchange.redirects.length > 0) {
    lines.push('', paint('Redirects', 'bold'));
    for (const hop of exchange.redirects) {
      lines.push(
        `  ${hop.status} ${redactUrl(hop.url)} → ${
          hop.location === null ? '(none)' : redactUrl(hop.location)
        }`,
      );
    }
    lines.push(field('Final URL', redactUrl(exchange.final.url), paint));
  }

  lines.push('', paint('Summary', 'bold'));
  lines.push(
    field(
      'Size',
      `${formatBytes(exchange.body.bytes)}${
        exchange.body.truncated ? ' (truncated at the size limit)' : ''
      }`,
      paint,
    ),
  );
  lines.push(field('Total', formatMs(exchange.timing.totalMs), paint));

  if (options.showBody && exchange.body.preview !== null) {
    lines.push('', paint('Body', 'bold'));
    lines.push(redactText(exchange.body.preview));
    if (exchange.body.previewTruncated) {
      lines.push(
        paint('  … preview truncated. Use --preview to show more.', 'dim'),
      );
    }
  } else if (options.showBody && exchange.body.encoding === 'binary') {
    lines.push(
      '',
      paint(
        `Body not shown: ${formatBytes(exchange.body.bytes)} of binary content.`,
        'dim',
      ),
    );
  }

  return lines.join('\n');
}

/** The `inspect` report: everything measured, and what could not be. */
export function formatInspect(exchange: Exchange, paint: Painter): string {
  const lines: string[] = [statusLine(exchange, paint), ''];

  lines.push(paint('Request', 'bold'));
  lines.push(field('Method', exchange.request.method, paint));
  lines.push(field('URL', redactUrl(exchange.request.url), paint));
  if (exchange.request.bodyBytes > 0) {
    lines.push(
      field(
        'Body',
        `${formatBytes(exchange.request.bodyBytes)} from ${
          exchange.request.bodySource ?? 'unknown'
        }`,
        paint,
      ),
    );
  }
  lines.push(...headerBlock(exchange.request.headers, paint));

  if (exchange.redirects.length > 0) {
    lines.push('', paint('Redirect chain', 'bold'));
    exchange.redirects.forEach((hop, index) => {
      lines.push(
        `  ${index + 1}. ${hop.status} ${hop.method} ${redactUrl(hop.url)}`,
      );
      lines.push(
        `     → ${
          hop.location === null ? '(none)' : redactUrl(hop.location)
        } in ${formatMs(hop.headersMs)}`,
      );
    });
  }

  lines.push('', paint('Response', 'bold'));
  lines.push(field('Final URL', redactUrl(exchange.final.url), paint));
  lines.push(
    field(
      'Status',
      `${exchange.final.status} ${exchange.final.statusText}`,
      paint,
    ),
  );
  const contentType = exchange.final.headers.find(
    (h) => h.name.toLowerCase() === 'content-type',
  );
  lines.push(
    field('Content type', contentType?.value ?? 'not declared', paint),
  );
  const contentLength = exchange.final.headers.find(
    (h) => h.name.toLowerCase() === 'content-length',
  );
  lines.push(
    field(
      'Content length',
      contentLength === undefined
        ? 'not declared (chunked or unknown)'
        : `${contentLength.value} declared`,
      paint,
    ),
  );
  lines.push(
    field(
      'Received',
      `${formatBytes(exchange.body.bytes)}${
        exchange.body.truncated ? ' (truncated at the size limit)' : ''
      }`,
      paint,
    ),
  );
  lines.push(field('SHA-256', exchange.body.sha256, paint));
  lines.push('', paint('Response headers', 'bold'));
  lines.push(...headerBlock(exchange.final.headers, paint));

  lines.push('', paint('Connection', 'bold'));
  const remote = exchange.final.remote;
  lines.push(
    field(
      'Peer',
      remote === null
        ? 'not available'
        : `${remote.address} port ${remote.port} (IPv${remote.family})`,
      paint,
    ),
  );
  const tls = exchange.final.tls;
  if (tls === null) {
    lines.push(field('TLS', 'not used (plain HTTP)', paint));
  } else {
    lines.push(field('TLS', tls.protocol ?? 'unknown', paint));
    lines.push(field('Cipher', tls.cipher ?? 'not available', paint));
    lines.push(field('Verified', tls.authorized ? 'yes' : 'no', paint));
    lines.push(field('Subject', tls.subject ?? 'not available', paint));
    lines.push(field('Issuer', tls.issuer ?? 'not available', paint));
    lines.push(
      field(
        'Valid',
        tls.validFrom === null || tls.validTo === null
          ? 'not available'
          : `${tls.validFrom} to ${tls.validTo}`,
        paint,
      ),
    );
  }

  lines.push('', paint('Timing', 'bold'));
  lines.push(field('Total', formatMs(exchange.timing.totalMs), paint));
  lines.push(field('To headers', formatMs(exchange.timing.headersMs), paint));
  lines.push(field('Body transfer', formatMs(exchange.timing.bodyMs), paint));
  lines.push(
    field(
      'Redirects',
      exchange.timing.redirectMs === null
        ? 'none'
        : formatMs(exchange.timing.redirectMs),
      paint,
    ),
  );
  lines.push(
    paint(
      '  Measured with a monotonic clock. DNS, TCP and TLS phases are not',
      'dim',
    ),
  );
  lines.push(
    paint('  reported separately because they cannot be measured here.', 'dim'),
  );

  return lines.join('\n');
}

export function formatComparison(
  comparison: Comparison,
  left: Exchange,
  right: Exchange,
  paint: Painter,
): string {
  const lines: string[] = [paint('Comparison', 'bold')];
  lines.push(field('Left', redactUrl(left.request.url), paint));
  lines.push(field('Right', redactUrl(right.request.url), paint));
  lines.push('');

  if (comparison.identical) {
    lines.push(paint('IDENTICAL', 'green'));
    lines.push('  No differences outside the ignored headers.');
  } else {
    lines.push(
      paint(
        `${comparison.differences.length} difference${
          comparison.differences.length === 1 ? '' : 's'
        }`,
        'yellow',
      ),
    );
    for (const difference of comparison.differences) {
      lines.push(`  ${paint(difference.field, 'bold')}`);
      lines.push(`    left   ${difference.left}`);
      lines.push(`    right  ${difference.right}`);
    }
  }

  lines.push('', paint('Timing', 'bold'));
  lines.push(field('Left', formatMs(comparison.timing.leftMs), paint));
  lines.push(field('Right', formatMs(comparison.timing.rightMs), paint));
  lines.push(
    field(
      'Difference',
      `${comparison.timing.deltaMs >= 0 ? '+' : '−'}${formatMs(
        Math.abs(comparison.timing.deltaMs),
      )}`,
      paint,
    ),
  );
  lines.push(
    paint(
      '  Timing is reported, never compared: a difference here may be',
      'dim',
    ),
  );
  lines.push(paint('  nothing more than network variability.', 'dim'));

  if (comparison.ignoredHeaders.length > 0) {
    lines.push(
      '',
      paint(`Ignored headers: ${comparison.ignoredHeaders.join(', ')}`, 'dim'),
    );
  }

  return lines.join('\n');
}

export function formatHistory(
  entries: readonly HistoryEntry[],
  paint: Painter,
): string {
  if (entries.length === 0) return 'No history recorded.';
  const lines: string[] = [];
  for (const entry of entries) {
    const status =
      entry.status === null
        ? paint('failed', 'red')
        : paint(String(entry.status), statusStyle(entry.status));
    lines.push(
      `${paint(entry.at, 'dim')}  ${status}  ${entry.method} ${entry.url}`,
    );
    if (entry.error !== null) lines.push(`    ${entry.error}`);
  }
  lines.push('');
  lines.push(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
  return lines.join('\n');
}
