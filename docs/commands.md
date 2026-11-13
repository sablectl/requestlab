# Command reference

RequestLab exposes five commands: `send`, `inspect`, `compare`, `history` and
`config`. Each one is described below with every option it accepts, the
default that applies when the option is absent and the effect of setting it.

All examples in this document were run against a local test server on
`127.0.0.1`. Replace the addresses with your own.

## Invocation

```sh
requestlab <command> [options]
```

Running the tool with no arguments prints the usage text and exits `2`.
`requestlab --help` prints the same text and exits `0`.

```console
$ requestlab --version
requestlab 1.0.0
```

## Argument syntax

- Long options are written `--name value` or `--name=value`.
- Short options are written `-n value`. They do not bundle: `-iI` is not
  accepted, write `-i -I`.
- A boolean option takes no value. `--fail=yes` is a usage error.
- `--` ends option parsing; every token after it is positional.
- An unknown option is an error, never a silently ignored token.

Numeric options must be non-negative whole numbers:

```console
$ requestlab send http://127.0.0.1:18211/ --timeout 1.5
error: Option "--timeout" must be a non-negative whole number, not "1.5".
```

## Global options

These are accepted by every command.

| Option            | Default | Effect                                       |
| ----------------- | ------- | -------------------------------------------- |
| `-h`, `--help`    | off     | Print the command's help and exit `0`        |
| `-v`, `--version` | off     | Print the release number and exit `0`        |
| `--json`          | off     | Write a JSON report to stdout                |
| `-q`, `--quiet`   | off     | Print only what was asked for; no summary    |
| `--no-color`      | off     | Disable colour regardless of the environment |

`--json` is a boolean report flag on every command. When it is given, the
command writes its JSON report to stdout and prints no human-readable report;
the shapes are listed under [JSON output](#json-output). It is distinct from
the `--json-body` request option described below, which takes a JSON request
body.

## Request options

`send`, `inspect` and `compare` share one set of request options. Where a
default is given as a setting name, the value comes from the configuration
file if one exists and from the built-in default otherwise; see
[configuration.md](configuration.md).

| Option                    | Value         | Default                               | Effect                                                                                                  |
| ------------------------- | ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `-X`, `--method`          | `METHOD`      | `GET`, or `POST` when a body is given | Request method. One of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS                                     |
| `-H`, `--header`          | `NAME: VALUE` | none                                  | Add a request header. Repeatable                                                                        |
| `--query`                 | `NAME=VALUE`  | none                                  | Append a query parameter to the URL. Repeatable                                                         |
| `-d`, `--data`            | `TEXT`        | none                                  | Body from text. Sets `Content-Type: text/plain; charset=utf-8`                                          |
| `--json-body`             | `JSON`        | none                                  | Body from JSON, parsed before sending. Sets `Content-Type: application/json`                            |
| `--data-file`             | `PATH`        | none                                  | Body read from a local file. No content type is implied                                                 |
| `--data-stdin`            | —             | off                                   | Body read from standard input. No content type is implied                                               |
| `-A`, `--user-agent`      | `STRING`      | `userAgent`                           | Value of the `User-Agent` header                                                                        |
| `--bearer-env`            | `VARIABLE`    | none                                  | Send `Authorization: Bearer <value of VARIABLE>`                                                        |
| `--basic-env`             | `VARIABLE`    | none                                  | Send `Authorization: Basic`, encoded from `user:password` in VARIABLE                                   |
| `--timeout`               | `MS`          | `timeoutMs` (30000)                   | Deadline for the whole exchange, redirects included                                                     |
| `--connect-timeout`       | `MS`          | `connectTimeoutMs` (10000)            | Deadline for establishing one connection                                                                |
| `--max-redirects`         | `N`           | `maxRedirects` (5)                    | Redirects followed before the request is refused                                                        |
| `--no-follow`             | —             | off                                   | Do not follow redirects; report the first response. Equivalent to `--max-redirects 0`                   |
| `--max-body-size`         | `BYTES`       | `maxBodyBytes` (5242880)              | Response bytes read before the body is truncated                                                        |
| `--restrict-destinations` | —             | `restrictDestinations` (false)        | Refuse loopback, private, link-local, unique-local, multicast, reserved and cloud-metadata destinations |

Notes on behaviour:

- At most one of `--data`, `--json-body`, `--data-file` and `--data-stdin` may be
  given. More than one is a usage error.
- A body cannot be sent with GET or HEAD. Choose an explicit method.
- `--header` always wins. A header you supply suppresses the generated
  `User-Agent`, `Accept`, `Authorization`, `Content-Type` or `Content-Length`
  of the same name.
- Unless suppressed that way, every request carries `User-Agent` and
  `Accept: */*`, and a request with a body also carries `Content-Length` and,
  where the body implies one, `Content-Type`.
- `--bearer-env` and `--basic-env` are mutually exclusive. The variable must
  be set and non-empty, and for `--basic-env` its value must contain a colon.
- A request body from a file or standard input is limited to 33554432 bytes.
- Header names are checked against the token grammar and header values may not
  contain line breaks.

## send

Perform one request and report the response.

```sh
requestlab send <url> [options]
```

### Output options

| Option                 | Default | Effect                                                   |
| ---------------------- | ------- | -------------------------------------------------------- |
| `-i`, `--show-request` | off     | Print the request line and request headers. Implies `-I` |
| `-I`, `--show-headers` | off     | Print the response headers                               |
| `--no-body`            | off     | Do not print the response body                           |
| `--preview`            | 2048    | Characters of body to print; `0` prints none             |
| `--fail`               | off     | Exit `1` when the final status is 400 or above           |
| `--save-history`       | off     | Record this request in the local history                 |

`--no-body` overrides `--preview`. With `-q` only the body preview is printed,
and nothing at all when there is no preview.

### Examples

A plain request:

```console
$ requestlab send http://127.0.0.1:18211/api/health
HTTP/1.1 200 OK

Summary
  Size            33 B
  Total           13 ms

Body
{"status":"ok","version":"2.4.1"}
```

Headers in both directions:

```console
$ requestlab send http://127.0.0.1:18211/api/health -i
HTTP/1.1 200 OK

Request
  Method          GET http://127.0.0.1:18211/api/health
  User-Agent: requestlab/1.0.0
  Accept: */*

Response headers
  Content-Type: application/json
  Content-Length: 33
  Date: Fri, 13 Nov 2026 17:26:14 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

Summary
  Size            33 B
  Total           10 ms

Body
{"status":"ok","version":"2.4.1"}
```

Post a JSON body:

```console
$ requestlab send http://127.0.0.1:18211/items --json-body '{"name":"widget"}'
HTTP/1.1 201 Created

Summary
  Size            31 B
  Total           12 ms

Body
{"id":"itm_42","name":"widget"}
```

Use the command in a script, where an error status should stop the run:

```console
$ requestlab send http://127.0.0.1:18211/missing --fail
HTTP/1.1 404 Not Found

Summary
  Size            21 B
  Total           10 ms

Body
{"error":"not found"}
$ echo $?
1
```

Take only the body, for a pipeline:

```console
$ requestlab send http://127.0.0.1:18211/api/health -q
{"status":"ok","version":"2.4.1"}
```

Send a token without writing it on the command line:

```sh
export API_TOKEN=…
requestlab send http://127.0.0.1:18211/api/health --bearer-env API_TOKEN -i
```

The header is redacted in the report:

```text
Request
  Method          GET http://127.0.0.1:18211/api/health
  Authorization: [redacted]
  User-Agent: requestlab/1.0.0
  Accept: */*
```

Stop at the first response instead of following the redirect:

```console
$ requestlab send http://127.0.0.1:18211/old --no-follow
HTTP/1.1 302 Found

Summary
  Size            0 B
  Total           10 ms

Body

```

## inspect

Perform one request and report everything that was measured: the request as
sent, the redirect chain, response metadata, the body digest, the peer
address, the TLS certificate and the timings. The body is never printed, so
the output options of `send` do not apply; `--save-history` and `--fail` are
accepted and behave as they do for `send`.

```sh
requestlab inspect <url> [options]
```

```console
$ requestlab inspect http://127.0.0.1:18211/api/health
HTTP/1.1 200 OK

Request
  Method          GET
  URL             http://127.0.0.1:18211/api/health
  User-Agent: requestlab/1.0.0
  Accept: */*

Response
  Final URL       http://127.0.0.1:18211/api/health
  Status          200 OK
  Content type    application/json
  Content length  33 declared
  Received        33 B
  SHA-256         fb3429e932c0f0c948cd2d48eb62786535f293fc7034390b18beff06e61cc715

Response headers
  Content-Type: application/json
  Content-Length: 33
  Date: Fri, 13 Nov 2026 17:26:14 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

Connection
  Peer            127.0.0.1 port 18211 (IPv4)
  TLS             not used (plain HTTP)

Timing
  Total           11 ms
  To headers      8 ms
  Body transfer   1 ms
  Redirects       none
  Measured with a monotonic clock. DNS, TCP and TLS phases are not
  reported separately because they cannot be measured here.
```

Over HTTPS the connection block carries the certificate:

```text
Connection
  Peer            127.0.0.1 port 18212 (IPv4)
  TLS             TLSv1.3
  Cipher          TLS_AES_256_GCM_SHA384
  Verified        yes
  Subject         CN=localhost
  Issuer          CN=localhost
  Valid           Nov 13 17:27:16 2026 GMT to Nov 15 17:27:16 2026 GMT
```

A value the server did not provide is reported as `not available`, and a
missing `Content-Length` as `not declared (chunked or unknown)`. Nothing is
inferred.

## compare

Perform two requests, in sequence, and report how the responses differ. The
requests are not concurrent: two requests sharing the machine's network would
distort the timings.

```sh
requestlab compare <url> <url> [options]
```

Compared by default: status, response headers, body size, body digest, final
URL and the number of redirects. Timing is reported but never counted as a
difference.

| Option                 | Default | Effect                                                          |
| ---------------------- | ------- | --------------------------------------------------------------- |
| `--ignore-header`      | none    | Ignore this header, in addition to the volatile set. Repeatable |
| `--only-header`        | none    | Compare only these headers. Repeatable                          |
| `--no-ignore-volatile` | off     | Compare the volatile headers too                                |
| `--no-body-compare`    | off     | Do not compare body size and digest                             |

`--only-header` replaces the selection entirely: when it is given, the ignored
set no longer applies and exactly the named headers are compared.

The volatile headers ignored by default are `age`, `alt-svc`, `cf-ray`,
`connection`, `date`, `expires`, `keep-alive`, `nel`, `report-to`,
`reporting-endpoints`, `request-id`, `server-timing`, `set-cookie`,
`traceparent`, `x-amz-cf-id`, `x-amz-request-id`, `x-correlation-id`,
`x-request-id`, `x-runtime`, `x-served-by`, `x-timer` and `x-trace-id`.

Repeated headers of the same name are joined with `, ` before comparison, and
a header present on one side only is reported as `(absent)` on the other.

Matching responses exit `0`:

```console
$ requestlab compare http://127.0.0.1:18211/api/health http://127.0.0.1:18211/api/health
Comparison
  Left            http://127.0.0.1:18211/api/health
  Right           http://127.0.0.1:18211/api/health

IDENTICAL
  No differences outside the ignored headers.

Timing
  Left            11 ms
  Right           1 ms
  Difference      −10 ms
  Timing is reported, never compared: a difference here may be
  nothing more than network variability.

Ignored headers: age, alt-svc, cf-ray, connection, date, expires, keep-alive, nel, report-to, reporting-endpoints, request-id, server-timing, set-cookie, traceparent, x-amz-cf-id, x-amz-request-id, x-correlation-id, x-request-id, x-runtime, x-served-by, x-timer, x-trace-id
```

Differing responses exit `1`:

```console
$ requestlab compare http://127.0.0.1:18211/api/health http://127.0.0.1:18211/missing
Comparison
  Left            http://127.0.0.1:18211/api/health
  Right           http://127.0.0.1:18211/missing

6 differences
  status
    left   200 OK
    right  404 Not Found
  content-length
    left   33
    right  (absent)
  transfer-encoding
    left   (absent)
    right  chunked
  body size
    left   33 bytes
    right  21 bytes
  body sha256
    left   fb3429e932c0f0c948cd2d48eb62786535f293fc7034390b18beff06e61cc715
    right  51d0a9e3bd9ffc25483790aaffe7a3597e642edd040dddb16aafc324e6e922ed
  final URL
    left   http://127.0.0.1:18211/api/health
    right  http://127.0.0.1:18211/missing
```

To check that a deployment serves the same payload while accepting that its
infrastructure headers differ:

```sh
requestlab compare http://127.0.0.1:18211/api/health http://127.0.0.1:18311/api/health \
  --ignore-header x-backend \
  --ignore-header via
```

To check one header and nothing else:

```sh
requestlab compare http://127.0.0.1:18211/ http://127.0.0.1:18311/ \
  --only-header cache-control \
  --no-body-compare
```

## history

Inspect the local request history. History is off until `historyEnabled` is
set or `--save-history` is given, bodies are never stored and credentials are
redacted before anything is written.

```sh
requestlab history [list|clear|path] [options]
```

| Subcommand | Effect                                                     |
| ---------- | ---------------------------------------------------------- |
| `list`     | Print the recorded entries. The default when none is given |
| `clear`    | Remove every entry and report how many were removed        |
| `path`     | Print the path of the history file                         |

| Option          | Default | Effect                                                           |
| --------------- | ------- | ---------------------------------------------------------------- |
| `-n`, `--limit` | 0       | Show at most this many of the most recent entries; `0` shows all |

```console
$ requestlab send http://127.0.0.1:18211/api/health -q --save-history
{"status":"ok","version":"2.4.1"}
$ requestlab history
2026-11-13T17:27:02.478Z  200  GET http://127.0.0.1:18211/api/health

1 entry.
```

An empty history prints `No history recorded.` A failed request is recorded
too, shown as `failed` with the error message on the following line.

```console
$ requestlab history path
/home/you/.local/state/requestlab/history.jsonl
$ requestlab history clear
Removed 1 entry from /home/you/.local/state/requestlab/history.jsonl.
```

With `-q`, `clear` prints nothing.

## config

Inspect and change stored settings. See
[configuration.md](configuration.md) for each setting.

```sh
requestlab config [show|path|set <key> <value>|unset <key>]
```

| Subcommand          | Effect                                                       |
| ------------------- | ------------------------------------------------------------ |
| `show`              | Print the effective settings. The default when none is given |
| `path`              | Print the path of the configuration file                     |
| `set <key> <value>` | Validate the value and write it to the file                  |
| `unset <key>`       | Remove the key, restoring the built-in default               |

```console
$ requestlab config show
/home/you/.config/requestlab/config.json (not written yet)

  connectTimeoutMs      10000 (default)
  historyEnabled        false (default)
  historyMaxAgeDays     30 (default)
  historyMaxEntries     200 (default)
  maxBodyBytes          5242880 (default)
  maxRedirects          5 (default)
  restrictDestinations  false (default)
  timeoutMs             30000 (default)
  userAgent             requestlab/1.0.0 (default)
```

A value that came from the file is printed without the `(default)` marker.
With `-q`, `set` and `unset` print nothing.

## Exit codes

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| 0    | Success. The request completed, or the comparison matched    |
| 1    | The request failed, or a check you asked for did not hold    |
| 2    | Usage error: unknown command, unknown flag, invalid argument |
| 3    | Unexpected internal error (a defect — please report it)      |
| 130  | Interrupted                                                  |

A 4xx or 5xx response is a successful request and exits `0` unless `--fail` is
given. `compare` exits `1` when the responses differ.

Each failure the tool reports carries an internal code that fixes its exit
code:

| Failure                | Code                  | Exit |
| ---------------------- | --------------------- | ---- |
| Usage                  | `usage`               | 2    |
| Invalid URL            | `invalid-url`         | 2    |
| Unsupported scheme     | `unsupported-scheme`  | 2    |
| Invalid configuration  | `config-invalid`      | 2    |
| Destination refused    | `destination-refused` | 1    |
| Name resolution failed | `dns-failure`         | 1    |
| Connection failed      | `connection-failed`   | 1    |
| TLS failure            | `tls-failure`         | 1    |
| Timed out              | `timeout`             | 1    |
| Too many redirects     | `too-many-redirects`  | 1    |
| Invalid redirect       | `invalid-redirect`    | 1    |
| Body could not be read | `body-read-failed`    | 1    |
| History unavailable    | `history-unavailable` | 1    |
| Interrupted            | `cancelled`           | 130  |

Errors are written to stderr as `error: <message>`, with an optional hint
indented on the next line. Reports are written to stdout, so the two can be
separated.

## JSON output

Every JSON report is wrapped in the same envelope. The schema version is
independent of the release number, so a consumer can detect a breaking change
without matching on the version.

```json
{
  "schemaVersion": 1,
  "tool": "requestlab",
  "version": "1.0.0",
  "command": "history",
  "generatedAt": "2026-11-13T17:26:30.231Z",
  "status": "ok",
  "result": {}
}
```

`status` is `ok`, or `different` for a `compare` that found differences; the
envelope also allows `failed`, which the current commands do not emit because
a failed request is reported on stderr and no report is written.
`generatedAt` is an ISO 8601 timestamp. Every value inside `result` has
already passed through redaction.

A report is written only when the command succeeds far enough to have one. An
error is printed to stderr as `error: <message>` in every case, with `--json`
or without it, so a script should test the exit code before parsing stdout.

### history

```json
{
  "path": "/home/you/.local/state/requestlab/history.jsonl",
  "count": 0,
  "entries": []
}
```

Each entry has the shape written to the history file: `at`, `method`, `url`,
`status`, `statusText`, `finalUrl`, `redirects`, `requestHeaders`,
`responseHeaders`, `requestBodyBytes`, `responseBodyBytes`, `responseSha256`,
`totalMs` and `error`. For a failed request `status`, `statusText`,
`finalUrl`, `responseBodyBytes`, `responseSha256` and `totalMs` are `null` and
`error` carries the message.

### config

```json
{
  "path": "/home/you/.config/requestlab/config.json",
  "exists": true,
  "settings": {
    "timeoutMs": 5000,
    "connectTimeoutMs": 10000,
    "maxRedirects": 5,
    "maxBodyBytes": 5242880,
    "userAgent": "requestlab/1.0.0",
    "restrictDestinations": false,
    "historyEnabled": false,
    "historyMaxEntries": 200,
    "historyMaxAgeDays": 30
  }
}
```

### send and inspect

`send --json` and `inspect --json` write the exchange report. `result` has
this shape:

```ts
{
  request: {
    method: string;
    url: string;                          // redacted
    headers: Record<string, string[]>;    // lower-cased names, redacted
    bodyBytes: number;
    bodySource: 'text' | 'json' | 'file' | 'stdin' | null;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    url: string;                          // redacted final URL
    headers: Record<string, string[]>;
    contentType: string | null;
    contentLength: number | null;
    remote: { address: string; family: 4 | 6; port: number } | null;
    tls: {
      protocol: string | null;
      cipher: string | null;
      subject: string | null;
      issuer: string | null;
      validFrom: string | null;
      validTo: string | null;
      subjectAltName: string | null;
      authorized: boolean;
    } | null;
  };
  redirects: {
    url: string;
    method: string;
    status: number;
    location: string | null;
    headersMs: number;
  }[];
  body: {
    bytes: number;
    sha256: string;
    encoding: 'utf-8' | 'binary';
    truncated: boolean;
    previewTruncated: boolean;
    preview: string | null;
  };
  timing: {
    totalMs: number;
    headersMs: number;
    bodyMs: number;
    redirectMs: number | null;
  };
  startedAt: string;
}
```

Durations are milliseconds rounded to three decimal places. `preview` is
`null` when the body was not printed, when the body is binary or when the
preview length is `0`. `inspect` always uses a preview length of `0`, so its
report never carries a preview; use `send --json` when the body text is
wanted.

### compare

`compare --json` writes the comparison report. The envelope `status` is `ok`
when the responses are identical and `different` otherwise, matching exit
codes `0` and `1`.

```ts
{
  identical: boolean;
  differences: {
    kind: 'status' | 'header' | 'size' | 'digest' | 'final-url' | 'redirects';
    field: string;
    left: string;
    right: string;
  }[];
  ignoredHeaders: string[];
  timing: {
    leftMs: number;
    rightMs: number;
    deltaMs: number;
    note: string;
  };
  left: {
    url: string;
    finalUrl: string;
    status: number;
    bytes: number;
    sha256: string;
    redirects: number;
  };
  right: { /* same shape as left */ };
}
```
