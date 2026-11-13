// Shared data shapes. Everything that crosses a module boundary is described
// here so that transport, comparison, history and presentation agree on one
// vocabulary.

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A header as it was sent or received, in the order it appeared. */
export interface HeaderPair {
  readonly name: string;
  readonly value: string;
}

/** A request body after it has been read and encoded. */
export interface PreparedBody {
  readonly bytes: Uint8Array;
  /** Set only when the body implies one and the caller supplied none. */
  readonly contentType?: string;
  /** Where the body came from, for the report. */
  readonly source: 'text' | 'json' | 'file' | 'stdin';
}

/** How a destination address may be used. */
export interface DestinationPolicy {
  /**
   * When false, only globally routable addresses are allowed. Loopback,
   * private, link-local, unique-local, multicast and reserved ranges are
   * refused, at the connection boundary and on every redirect.
   */
  readonly allowPrivate: boolean;
}

export interface RequestSpec {
  readonly url: string;
  readonly method: HttpMethod;
  readonly headers: readonly HeaderPair[];
  readonly body?: PreparedBody;
  /** Deadline for the whole exchange, including redirects. */
  readonly timeoutMs: number;
  /** Deadline for establishing a single connection. */
  readonly connectTimeoutMs: number;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly policy: DestinationPolicy;
}

export interface RemotePeer {
  readonly address: string;
  readonly family: 4 | 6;
  readonly port: number;
}

export interface TlsInfo {
  readonly protocol: string | null;
  readonly cipher: string | null;
  readonly subject: string | null;
  readonly issuer: string | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly subjectAltName: string | null;
  readonly authorized: boolean;
}

/** One response in the chain. Every hop but the last is a redirect. */
export interface Hop {
  readonly url: string;
  readonly method: HttpMethod;
  readonly status: number;
  readonly statusText: string;
  readonly httpVersion: string;
  readonly headers: readonly HeaderPair[];
  readonly location: string | null;
  /** Milliseconds from starting this hop to its headers being complete. */
  readonly headersMs: number;
  readonly remote: RemotePeer | null;
  readonly tls: TlsInfo | null;
}

export interface BodyRecord {
  readonly bytes: number;
  readonly sha256: string;
  /** Decoded preview, truncated to the requested limit. */
  readonly preview: string | null;
  /** True when the preview is shorter than the body. */
  readonly previewTruncated: boolean;
  /** True when the body itself was cut short by the size limit. */
  readonly truncated: boolean;
  readonly encoding: 'utf-8' | 'binary';
}

export interface Timing {
  /** Monotonic milliseconds from the first connection attempt to completion. */
  readonly totalMs: number;
  /** To the final response's headers, measured from the start of that hop. */
  readonly headersMs: number;
  /** Transfer time of the final response body. */
  readonly bodyMs: number;
  /** Time spent on all redirect hops, or null when there were none. */
  readonly redirectMs: number | null;
}

export interface Exchange {
  readonly request: {
    readonly method: HttpMethod;
    readonly url: string;
    readonly headers: readonly HeaderPair[];
    readonly bodyBytes: number;
    readonly bodySource: PreparedBody['source'] | null;
  };
  readonly redirects: readonly Hop[];
  readonly final: Hop;
  readonly body: BodyRecord;
  readonly timing: Timing;
  readonly startedAt: string;
}
