# Technical debt

Known limitations and deferred work. Each item states what the limitation is,
what it costs and what would resolve it. Nothing here is a plan or a promise;
it is a record of where the implementation stops.

## HTTP/1.1 only

The transport is built on `node:http` and `node:https`, so every request is
HTTP/1.1. A server that offers HTTP/2 or HTTP/3 is reached over its HTTP/1.1
interface if it has one and is otherwise unreachable.

**Impact.** Protocol-specific behaviour cannot be debugged with this tool:
header compression, stream multiplexing, server push and QUIC are invisible.
A response served only over HTTP/2 cannot be fetched at all.

**Resolution.** A second transport over `node:http2`, behind the same
`Exchange` shape, with protocol negotiation reported in the `inspect` output.
The redirect loop, the guarded lookup and the size limit would all have to be
re-implemented against that interface.

## No proxy support

`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and their lower-case forms are
ignored. Every request goes directly to the destination.

**Impact.** The tool cannot be used from a network that requires an egress
proxy, and it cannot reproduce what a proxied client sees. A result that
disagrees with a proxied browser may be explained by this alone.

**Resolution.** An agent that understands `CONNECT` tunnelling, plus the
environment variables and the no-proxy matching rules. The destination guard
would need rethinking: with a proxy the address connected to is the proxy's,
and the policy decision moves to a host name the tool no longer resolves.

## No cookie jar

Cookies are not stored and are not sent back. `Set-Cookie` is reported like
any other header, redacted, and then forgotten.

**Impact.** A session cannot be established across two invocations, and a
redirect chain that depends on a cookie set part way through will not follow
the path a browser would.

**Resolution.** A cookie store with origin and path matching and explicit
opt-in, kept in the state directory. It would be credential-bearing state,
so it would need the same redaction and file-mode treatment as the history,
and a way to clear it.

## No compression negotiation

No `Accept-Encoding` is sent, and no response body is decompressed. Responses
are reported as they arrive on the wire.

**Impact.** A server that compresses regardless will produce a body that is
reported as binary, with a digest over the compressed bytes. Sizes are
wire sizes, which is accurate but is not what a browser would report.

**Resolution.** Send `Accept-Encoding` and decode gzip, deflate and brotli
through `node:zlib`, reporting both the wire size and the decoded size so
neither number is lost. The size limit would then need to apply to both, to
keep a compression bomb bounded.

## No per-phase DNS, TCP and TLS timing

Timing covers the total exchange, the time to the response headers and the
body transfer time. The handshake phases are not separated.

**Impact.** A slow request can be narrowed to headers against body, but not
to resolution against connection against handshake. Diagnosing a slow TLS
negotiation needs another tool.

**Resolution.** Socket-level instrumentation: timestamps around the lookup
callback and on the `connect` and `secureConnect` events, carried through to
the report. The values must be measured rather than inferred, and until they
can be, none is printed — an invented number is worse than an absent one.

## The response body is buffered

The body is read into memory up to `maxBodyBytes`, 5 MiB by default, so that
it can be hashed and previewed.

**Impact.** Raising the limit raises the memory the process may use, and a
large response cannot be streamed to a file. The digest and the reported size
describe the bytes that were read, so a truncated read gives a digest that
must not be compared with a complete one.

**Resolution.** Hash incrementally as chunks arrive, keep only the preview
window in memory and offer an option to write the body to a path. Truncation
would still need to be reported distinctly, since a digest over a prefix is
not a digest of the resource.

## macOS and Windows are untested

Development and verification are on Linux with Node 26. CI runs on Linux
across Node 20.19, 22 and 24.

**Impact.** Path handling, file modes, terminal detection and signal
behaviour are all plausible sources of platform-specific defects, and none is
exercised. Mode `0600` in particular does not mean on Windows what it means
on a POSIX system.

**Resolution.** Add macOS and Windows runners to CI and make the integration
suite pass on them. Until a runner proves it, the claim will not be made.

## The history is rewritten rather than appended

Despite the `.jsonl` extension, every write reads the whole file, applies
retention and writes it back through a temporary file and a rename.

**Impact.** The cost of recording a request grows with the size of the
history, and two commands recording at the same time can lose an entry: both
read the same file and the second rename wins. The reader tolerates one
unreadable line, which limits the damage from an interrupted write but does
not prevent the loss.

**Resolution.** Append single lines under an exclusive lock and compact
separately, on a schedule or when the file exceeds a threshold. Retention
would move out of the write path into the compaction step.

## No benchmarking

Each command performs one request per URL, once. `compare` performs two, in
sequence, deliberately: concurrent requests sharing the machine's network
would distort the timings it reports.

**Impact.** A single sample cannot distinguish a slow service from an unlucky
request, and the timing difference `compare` prints carries a warning for
exactly that reason. There is no way to repeat a request, to run several in
parallel or to report a distribution.

**Resolution.** A repetition option with a summary over the samples — median
and percentiles rather than a mean — and an explicit concurrency setting,
reported alongside the results so that a number is never read without knowing
how it was produced.

## Redaction is a list, and body redaction is best effort

Header and query-parameter redaction work from fixed lists of names. Body
previews are filtered by pattern.

**Impact.** A credential in a header or parameter of your own naming is
printed in full, and a secret in a body shape the filter does not recognise
is printed in full. `--no-body` is the only certainty.

**Resolution.** Configurable additional names for headers and parameters, so
a service with its own conventions can be covered. Body redaction cannot be
made complete and should not be described as if it could.
