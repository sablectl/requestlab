// HTTP transport.
//
// Built on `node:http` and `node:https` rather than `fetch`, for three
// reasons: redirects must be followed one hop at a time so that each
// destination can be re-checked, the socket is needed for peer address and
// certificate metadata, and the response must be consumed as a stream so that
// a size limit can be enforced before the body is in memory.
//
// Only what the implementation can actually observe is reported. There is no
// DNS, TCP or TLS handshake breakdown here, because separating those phases
// reliably is not possible through this interface, and an invented number is
// worse than an absent one.

import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type {
  ClientRequest,
  IncomingMessage,
  OutgoingHttpHeaders,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import {
  ALLOWED_PROTOCOLS,
  assertAllowed,
  classifyAddress,
  createGuardedLookup,
} from './destination.js';
import { AppError } from './errors.js';
import type {
  Exchange,
  HeaderPair,
  Hop,
  HttpMethod,
  RemotePeer,
  RequestSpec,
  TlsInfo,
} from './types.js';

/** Monotonic milliseconds. Never the wall clock: that can move backwards. */
export function now(): number {
  return Number(process.hrtime.bigint() / 1_000n) / 1000;
}

export interface SendOptions {
  /** Characters of decoded body to keep for the preview. 0 keeps none. */
  readonly previewChars: number;
  /** Aborts the exchange when the caller is interrupted. */
  readonly signal?: AbortSignal;
}

const DEFAULT_PREVIEW_CHARS = 2048;

function headerPairs(message: IncomingMessage): readonly HeaderPair[] {
  const raw = message.rawHeaders;
  const pairs: HeaderPair[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    pairs.push({ name: raw[i] ?? '', value: raw[i + 1] ?? '' });
  }
  return pairs;
}

function peerOf(socket: Socket | undefined): RemotePeer | null {
  if (socket?.remoteAddress === undefined) return null;
  return {
    address: socket.remoteAddress,
    family: socket.remoteFamily === 'IPv6' ? 6 : 4,
    port: socket.remotePort ?? 0,
  };
}

function tlsOf(socket: Socket | undefined): TlsInfo | null {
  if (!socket || !('getPeerCertificate' in socket)) return null;
  const tls = socket as TLSSocket;
  const certificate = tls.getPeerCertificate();
  const cipher = tls.getCipher() as { name?: string } | null;
  const empty = Object.keys(certificate).length === 0;
  const describe = (value: unknown): string | null => {
    if (value === null || typeof value !== 'object') return null;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `${k}=${String(v)}`);
    return entries.length === 0 ? null : entries.join(', ');
  };
  return {
    protocol: tls.getProtocol(),
    cipher: cipher?.name ?? null,
    subject: empty ? null : describe(certificate.subject),
    issuer: empty ? null : describe(certificate.issuer),
    validFrom: empty ? null : (certificate.valid_from ?? null),
    validTo: empty ? null : (certificate.valid_to ?? null),
    subjectAltName: empty ? null : (certificate.subjectaltname ?? null),
    authorized: tls.authorized,
  };
}

/** Methods that are rewritten to GET when a 301, 302 or 303 is followed. */
function methodAfterRedirect(
  status: number,
  method: HttpMethod,
): { method: HttpMethod; dropBody: boolean } {
  if (status === 303 && method !== 'HEAD') {
    return { method: 'GET', dropBody: true };
  }
  if ((status === 301 || status === 302) && method === 'POST') {
    return { method: 'GET', dropBody: true };
  }
  return { method, dropBody: false };
}

function toOutgoing(headers: readonly HeaderPair[]): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const { name, value } of headers) {
    const existing = out[name];
    if (existing === undefined) {
      out[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[name] = [String(existing), value];
    }
  }
  return out;
}

function translateSocketError(error: NodeJS.ErrnoException): AppError {
  if (error instanceof AppError) return error;
  const code = error.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new AppError(
      'dns-failure',
      `The host name could not be resolved (${code}).`,
      'Check the host name and this machine\u2019s DNS configuration.',
    );
  }
  if (code.startsWith('ERR_TLS') || code.startsWith('UNABLE_TO_VERIFY')) {
    return new AppError('tls-failure', `TLS failed: ${code}.`);
  }
  if (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID'
  ) {
    return new AppError(
      'tls-failure',
      `The server\u2019s certificate was rejected: ${code}.`,
      'RequestLab always verifies certificates and has no bypass.',
    );
  }
  return new AppError(
    'connection-failed',
    `The connection failed${code === '' ? '' : ` (${code})`}.`,
  );
}

interface HopResult {
  readonly hop: Hop;
  readonly response: IncomingMessage;
}

function performHop(
  url: URL,
  method: HttpMethod,
  headers: readonly HeaderPair[],
  body: Uint8Array | null,
  spec: RequestSpec,
  signal: AbortSignal,
): Promise<HopResult> {
  const started = now();
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  // A literal address never reaches the lookup function, so it is classified
  // here. Without this, `--restrict-destinations` would stop a name that
  // resolves to 127.0.0.1 but not 127.0.0.1 written out.
  // `URL` keeps the brackets around an IPv6 host; `http.request` wants the
  // address without them, and the classifier does too.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) !== 0) {
    assertAllowed(classifyAddress(hostname), hostname, spec.policy);
  }
  return new Promise<HopResult>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof AppError
          ? error
          : translateSocketError(error as NodeJS.ErrnoException),
      );
    };

    let request: ClientRequest;
    try {
      request = send({
        protocol: url.protocol,
        hostname,
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method,
        headers: toOutgoing(headers),
        lookup: createGuardedLookup(spec.policy),
        signal,
        // Certificate verification is never disabled. There is no flag for it.
        rejectUnauthorized: true,
        setHost: true,
      });
    } catch (error) {
      fail(error);
      return;
    }

    // Connection deadline, distinct from the overall deadline so that a host
    // that accepts but never answers is reported differently from one that
    // never accepts at all.
    const connectTimer = setTimeout(() => {
      request.destroy(
        new AppError(
          'timeout',
          `No connection within ${spec.connectTimeoutMs} ms.`,
          'Raise --connect-timeout if the host is simply slow to accept.',
        ),
      );
    }, spec.connectTimeoutMs);
    connectTimer.unref();

    request.on('socket', (socket: Socket) => {
      const clear = (): void => {
        clearTimeout(connectTimer);
      };
      if (!socket.connecting) clear();
      else socket.once('connect', clear);
      socket.once('secureConnect', clear);
    });

    request.on('error', (error) => {
      clearTimeout(connectTimer);
      fail(error);
    });

    request.on('response', (response: IncomingMessage) => {
      clearTimeout(connectTimer);
      if (settled) return;
      settled = true;
      const socket = response.socket as Socket | undefined;
      const location = response.headers.location;
      resolve({
        response,
        hop: {
          url: url.toString(),
          method,
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? '',
          httpVersion: response.httpVersion,
          headers: headerPairs(response),
          location: typeof location === 'string' ? location : null,
          headersMs: now() - started,
          remote: peerOf(socket),
          tls: tlsOf(socket),
        },
      });
    });

    if (body !== null && body.byteLength > 0) request.write(body);
    request.end();
  });
}

/** Read a response, stopping at the size limit instead of buffering past it. */
function readBody(
  response: IncomingMessage,
  limit: number,
): Promise<{ bytes: Buffer; truncated: boolean; ms: number }> {
  const started = now();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    response.on('data', (chunk: Buffer) => {
      if (truncated) return;
      const remaining = limit - total;
      if (chunk.byteLength >= remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total = limit;
        truncated = true;
        response.destroy();
        resolve({
          bytes: Buffer.concat(chunks),
          truncated,
          ms: now() - started,
        });
        return;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    });
    response.on('end', () => {
      resolve({ bytes: Buffer.concat(chunks), truncated, ms: now() - started });
    });
    response.on('error', (error: NodeJS.ErrnoException) => {
      if (truncated) return;
      reject(
        new AppError(
          'body-read-failed',
          `The response body could not be read${
            error.code === undefined ? '' : ` (${error.code})`
          }.`,
        ),
      );
    });
  });
}

function looksTextual(headers: readonly HeaderPair[]): boolean {
  const type = headers
    .find((h) => h.name.toLowerCase() === 'content-type')
    ?.value.toLowerCase();
  if (type === undefined) return true;
  return (
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    type.includes('javascript') ||
    type.includes('x-www-form-urlencoded')
  );
}

export function parseRequestUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError(
      'invalid-url',
      `"${input}" is not a valid absolute URL.`,
      'Include the scheme, for example https://example.com/path.',
    );
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new AppError(
      'unsupported-scheme',
      `The scheme "${url.protocol.replace(':', '')}" is not supported.`,
      'RequestLab speaks http and https only.',
    );
  }
  return url;
}

/**
 * Execute a request, following redirects one hop at a time, and return
 * everything that was observed.
 */
export async function send(
  spec: RequestSpec,
  options: SendOptions = { previewChars: DEFAULT_PREVIEW_CHARS },
): Promise<Exchange> {
  const startedAt = new Date().toISOString();
  const overall = new AbortController();
  const external = options.signal;
  const onAbort = (): void => {
    overall.abort(new AppError('cancelled', 'Interrupted.'));
  };
  // A signal that was already aborted will never emit the event again, so it
  // is acted on directly rather than waited for.
  if (external?.aborted === true) onAbort();
  else external?.addEventListener('abort', onAbort, { once: true });
  const deadline = setTimeout(() => {
    overall.abort(
      new AppError(
        'timeout',
        `The request did not complete within ${spec.timeoutMs} ms.`,
        'Raise --timeout, or use --max-body-size if the body is large.',
      ),
    );
  }, spec.timeoutMs);
  deadline.unref();

  const begin = now();
  let url = parseRequestUrl(spec.url);
  let method = spec.method;
  let headers = [...spec.headers];
  let body: Uint8Array | null = spec.body?.bytes ?? null;
  const redirects: Hop[] = [];

  try {
    for (;;) {
      const { hop, response } = await performHop(
        url,
        method,
        headers,
        body,
        spec,
        overall.signal,
      );

      const isRedirect =
        hop.location !== null && [301, 302, 303, 307, 308].includes(hop.status);

      if (isRedirect && spec.maxRedirects > 0) {
        if (redirects.length >= spec.maxRedirects) {
          response.resume();
          throw new AppError(
            'too-many-redirects',
            `More than ${spec.maxRedirects} redirects were followed.`,
            'Raise --max-redirects, or use --no-follow to stop at the first.',
          );
        }
        let next: URL;
        try {
          next = new URL(hop.location ?? '', url);
        } catch {
          response.resume();
          throw new AppError(
            'invalid-redirect',
            'The server sent a Location header that is not a valid URL.',
          );
        }
        if (!ALLOWED_PROTOCOLS.has(next.protocol)) {
          response.resume();
          throw new AppError(
            'invalid-redirect',
            `The server redirected to an unsupported scheme ` +
              `("${next.protocol.replace(':', '')}").`,
          );
        }
        response.resume();
        redirects.push(hop);

        const rewritten = methodAfterRedirect(hop.status, method);
        method = rewritten.method;
        if (rewritten.dropBody) body = null;
        // Credentials are not carried to another origin.
        if (next.host !== url.host || next.protocol !== url.protocol) {
          headers = headers.filter(
            (h) =>
              !['authorization', 'cookie', 'proxy-authorization'].includes(
                h.name.toLowerCase(),
              ),
          );
        }
        if (body === null) {
          headers = headers.filter(
            (h) =>
              !['content-type', 'content-length'].includes(
                h.name.toLowerCase(),
              ),
          );
        }
        url = next;
        continue;
      }

      const read = await readBody(response, spec.maxBodyBytes);
      const digest = createHash('sha256').update(read.bytes).digest('hex');
      const textual = looksTextual(hop.headers);
      const decoded = textual ? read.bytes.toString('utf8') : null;
      const preview =
        decoded === null || options.previewChars === 0
          ? null
          : decoded.slice(0, options.previewChars);
      const total = now() - begin;

      return {
        startedAt,
        request: {
          method: spec.method,
          url: spec.url,
          headers: spec.headers,
          bodyBytes: spec.body?.bytes.byteLength ?? 0,
          bodySource: spec.body?.source ?? null,
        },
        redirects,
        final: hop,
        body: {
          bytes: read.bytes.byteLength,
          sha256: digest,
          preview,
          previewTruncated:
            decoded !== null &&
            preview !== null &&
            decoded.length > preview.length,
          truncated: read.truncated,
          encoding: textual ? 'utf-8' : 'binary',
        },
        timing: {
          totalMs: total,
          headersMs: hop.headersMs,
          bodyMs: read.ms,
          redirectMs:
            redirects.length === 0 ? null : total - hop.headersMs - read.ms,
        },
      };
    }
  } catch (error) {
    if (overall.signal.aborted && overall.signal.reason instanceof AppError) {
      throw overall.signal.reason;
    }
    throw error instanceof AppError
      ? error
      : translateSocketError(error as NodeJS.ErrnoException);
  } finally {
    clearTimeout(deadline);
    external?.removeEventListener('abort', onAbort);
  }
}
