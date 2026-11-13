# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-11-13

First release.

### Added

- `send`: perform a request over HTTP or HTTPS with GET, POST, PUT, PATCH,
  DELETE, HEAD or OPTIONS, custom headers, query parameters and a body from
  text (`--data`), JSON (`--json-body`), a file or standard input. Reports
  the status, timing and a
  body preview, with `--fail` to exit `1` on a 4xx or 5xx status.
- `inspect`: the full diagnostic report — redirect chain, response metadata,
  body digest, peer address, TLS certificate details and the measurable
  timings.
- `compare`: perform two requests and report differences in status, headers,
  size, body digest, final URL and redirect count. Volatile headers are
  ignored by default; `--ignore-header`, `--only-header`,
  `--no-ignore-volatile` and `--no-body-compare` adjust the comparison.
  Timing is reported but never counted as a difference.
- `history`: opt-in local request history with `list`, `clear` and `path`.
  Off by default, written with mode `0600`, retained by count and age, and
  holding no request or response bodies.
- `config`: `show`, `path`, `set` and `unset` for stored settings, written
  atomically with mode `0600`.
- JSON output on every command behind `--json`, with an envelope versioned
  independently of the tool.
- Credential redaction for `Authorization`, cookies, API-key headers, URL
  user information and credential-shaped query parameters, applied before
  output and before anything is written to the history.
- `--bearer-env` and `--basic-env`, which read a credential from an
  environment variable rather than the command line.
- Destination restrictions (`--restrict-destinations`) covering loopback,
  private, link-local, unique-local, multicast, reserved and cloud-metadata
  addresses, enforced on resolved addresses at the connection boundary and
  repeated on every redirect.
- Resource limits: connection deadline, overall deadline, redirect cap and
  response-size cap, with the body read as a stream and stopped at the limit.
- `NO_COLOR`, `FORCE_COLOR` and `TERM=dumb` support, documented exit codes,
  and cancellation on SIGINT.

### Security

- TLS certificates are always verified. There is no option to disable
  verification.
- `Authorization`, `Cookie` and `Proxy-Authorization` are dropped when a
  redirect crosses to another origin.
- No telemetry, no background network activity and no automatic crawling.

[1.0.0]: https://github.com/sablectl/requestlab/releases/tag/v1.0.0
