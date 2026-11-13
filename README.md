# RequestLab

**HTTP Inspection and Debugging Toolkit** — request execution, response
inspection and response comparison for the command line.

[![CI](https://github.com/sablectl/requestlab/actions/workflows/ci.yml/badge.svg)](https://github.com/sablectl/requestlab/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

RequestLab performs one HTTP request at a time and reports what happened: the
status, the headers, the redirect chain, the bytes received, how long each
measurable phase took, and the certificate the server presented. It has no
runtime dependencies, sends nothing anywhere except the address you give it,
and keeps no record of a request unless you ask it to.

## What it does

- Performs GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS requests over HTTP
  and HTTPS, with custom headers, query parameters and bodies from text, JSON,
  a file or standard input, over IPv4 and IPv6.
- Follows redirects one hop at a time, records the chain, and re-checks the
  destination at every hop. Credentials are dropped when a redirect crosses to
  another origin.
- Reports response metadata, the SHA-256 digest of the body, the peer address
  and TLS certificate details, distinguishing measured values from those the
  server did not provide.
- Measures total duration, time to the response headers and body transfer time
  with a monotonic clock. Phases it cannot measure accurately are not reported.
- Compares two responses by status, headers, size, digest and final URL, with
  volatile headers ignored by default.
- Redacts credentials — `Authorization`, cookies, API-key headers, user
  information and credential-shaped query parameters — before anything is
  printed or stored.
- Keeps an optional local history that is off by default, stores no request or
  response bodies, and never leaves the machine.

Certificate verification is always on and there is no flag to turn it off.

## Requirements

- Node.js 20.19 or later.
- No runtime dependencies.

## Install

RequestLab is distributed through GitHub only. Build it from source:

```sh
git clone https://github.com/sablectl/requestlab.git
cd requestlab
npm ci
npm run build
```

Run it directly:

```sh
node dist/bin/requestlab.js --help
```

or make a `requestlab` command available on your path:

```sh
npm link
requestlab --help
```

**This package is not published to npm.** GitHub releases are the distribution
channel. If you find a package by this name on a registry, it is not this
project.

## Quick start

Perform a request and see what came back:

```console
$ requestlab send https://example.com/
HTTP/1.1 200 OK

Summary
  Size            1.2 KiB
  Total           184 ms

Body
<!doctype html>
…
```

Look at everything that was measured:

```console
$ requestlab inspect http://127.0.0.1:8080/api/health
HTTP/1.1 200 OK

Request
  Method          GET
  URL             http://127.0.0.1:8080/api/health
  User-Agent: requestlab/1.0.0
  Accept: */*

Response
  Final URL       http://127.0.0.1:8080/api/health
  Status          200 OK
  Content type    application/json
  Content length  27 declared
  Received        27 B
  SHA-256         9f2c…

Connection
  Peer            127.0.0.1 port 8080 (IPv4)
  TLS             not used (plain HTTP)

Timing
  Total           4 ms
  To headers      3 ms
  Body transfer   0 ms
  Redirects       none
  Measured with a monotonic clock. DNS, TCP and TLS phases are not
  reported separately because they cannot be measured here.
```

Post a JSON body and fail the command on an error status:

```sh
requestlab send https://api.example.com/items \
  --json-body '{"name":"widget"}' \
  --bearer-env API_TOKEN \
  --fail
```

Check whether two deployments answer the same way:

```sh
requestlab compare https://blue.example.com/health https://green.example.com/health
```

## Commands

| Command   | Purpose                                             |
| --------- | --------------------------------------------------- |
| `send`    | Perform a request and report the response.          |
| `inspect` | Perform a request and report everything measured.   |
| `compare` | Perform two requests and report the differences.    |
| `history` | Inspect, locate or clear the local request history. |
| `config`  | Inspect and change stored settings.                 |

Global options: `-h, --help`, `-v, --version`, `--json`, `-q, --quiet`,
`--no-color`. The full reference is in
[docs/commands.md](docs/commands.md).

## Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 0    | Success. The request completed, or the comparison matched.    |
| 1    | The request failed, or a check you asked for did not hold.    |
| 2    | Usage error: unknown command, unknown flag, invalid argument. |
| 3    | Unexpected internal error (a defect — please report it).      |
| 130  | Interrupted.                                                  |

A response with a 4xx or 5xx status is a successful request, so it exits `0`
unless `--fail` is given. `compare` exits `1` when the two responses differ.

## JSON output

```sh
requestlab send https://example.com/ --json | jq '.result.response.status'
```

The envelope is versioned independently of the tool, so a consumer can detect
a breaking change without matching on the release number:

```json
{
  "schemaVersion": 1,
  "tool": "requestlab",
  "version": "1.0.0",
  "command": "send",
  "generatedAt": "2026-11-13T12:00:00.000Z",
  "status": "ok",
  "result": {}
}
```

## Configuration

There is no configuration file until you write one with `requestlab config
set`. It lives at `$XDG_CONFIG_HOME/requestlab/config.json` (or
`~/.config/requestlab/config.json`) with mode `0600`, and precedence is
command line, then file, then built-in default.

| Setting                | Default            | Effect                                 |
| ---------------------- | ------------------ | -------------------------------------- |
| `timeoutMs`            | 30000              | Deadline for the whole exchange        |
| `connectTimeoutMs`     | 10000              | Deadline for establishing a connection |
| `maxRedirects`         | 5                  | Redirects followed before refusing     |
| `maxBodyBytes`         | 5242880            | Response bytes read before truncating  |
| `userAgent`            | `requestlab/1.0.0` | Default `User-Agent`                   |
| `restrictDestinations` | false              | Refuse non-global destinations         |
| `historyEnabled`       | false              | Record every request in the history    |
| `historyMaxEntries`    | 200                | Entries retained                       |
| `historyMaxAgeDays`    | 30                 | Age at which entries are dropped       |

`NO_COLOR`, `FORCE_COLOR` and `TERM=dumb` are honoured. Precedence is
`--no-color` → `NO_COLOR` → `TERM=dumb` → `FORCE_COLOR` → TTY detection.
See [docs/configuration.md](docs/configuration.md).

## Security

RequestLab is a local tool that sends requests you asked for, so requests to
localhost and private networks are allowed by default — debugging a service on
`127.0.0.1` is the ordinary case. `--restrict-destinations` (or
`restrictDestinations`) refuses loopback, private, link-local, unique-local,
multicast, reserved and cloud-metadata destinations for controlled
environments.

That restriction is enforced on resolved addresses at the connection
boundary, not by inspecting the URL string, and it is repeated on every
redirect. URL validation alone does not prevent server-side request forgery,
and this project does not claim that it does. The full threat model, including
what is and is not covered, is in
[docs/security-model.md](docs/security-model.md).

Credentials are redacted before output and before anything is written to the
history. Pass secrets with `--bearer-env` or `--basic-env`, which read an
environment variable: a secret written directly on the command line is visible
to other processes and is kept in shell history. To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## Documentation

- [Command reference](docs/commands.md)
- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Security model](docs/security-model.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Technical debt](docs/technical-debt.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## Limitations

- HTTP/1.1 only. The transport is built on `node:http` and `node:https`, so
  HTTP/2 and HTTP/3 servers are reached over their HTTP/1.1 interface if they
  offer one, and are otherwise unreachable.
- Timing covers the total exchange, the time to the response headers and the
  body transfer. DNS, TCP and TLS handshake phases are not reported, because
  this interface cannot separate them accurately.
- Response bodies are buffered up to `maxBodyBytes` to hash and preview them,
  so a very large limit costs memory. The default is 5 MiB.
- Proxies are not supported: `HTTP_PROXY` and related variables are ignored.
- Cookies are not stored between requests, and no cookie jar is kept.
- Compression is not negotiated, so responses are reported as they arrive on
  the wire.
- Request body redaction is best effort for previews. A body can carry a
  secret in any shape; `--no-body` is the only way to be certain none is
  printed.
- Developed and verified on Linux with Node 26. CI runs on Linux across Node
  20.19, 22 and 24. macOS and Windows are expected to work, but they are not
  tested, and that claim will not be made until a runner proves it.

## Licence and author

Released under the [MIT licence](LICENSE).

Written by Sable (<https://github.com/sablectl>) — <https://sablectl.dev>.
