# Architecture

RequestLab is a single-process command-line tool written in TypeScript and
compiled to ECMAScript modules for Node.js. It has no runtime dependencies.
This document describes how the source is arranged, why the main decisions
were taken and what is deliberately absent.

## Module map

```text
src/
  bin/requestlab.ts     Entry point. The only file that touches the process
  cli/
    args.ts             Argument parsing and value validation
    help.ts             Help text, generated from the option tables
    request-options.ts  Shared request options and request construction
    run.ts              Command dispatch
  core/
    body.ts             Request body preparation
    compare.ts          Response comparison
    config.ts           Settings, file locations, load and save
    destination.ts      Address classification and the connection guard
    errors.ts           Error vocabulary and exit codes
    history.ts          Local request history
    redact.ts           Credential redaction
    transport.ts        HTTP transport and the redirect loop
    types.ts            Shared data shapes
  output/
    colour.ts           Colour decision and the painter
    human.ts            Human-readable formatting
    json.ts             JSON envelope and report shapes
  index.ts              Library surface
  version.ts            The release number
```

## Dependency direction

Dependencies point one way:

```text
bin → cli → core
            ↑
         output
```

- `bin` knows about the process: `process.argv`, the streams, `SIGINT`, the
  exit code. It is the only file that does.
- `cli` dispatches commands and is the only layer that reads both `core` and
  `output`.
- `core` performs the work. It never imports from `cli` or `output`, so no
  decision about presentation or argument syntax can leak into it.
- `output` imports from `core` for the data shapes it formats and for
  redaction, and nothing imports `output` except `cli`.

Two consequences follow. The command surface is testable in process: `run`
takes an `Io` object holding the arguments, the environment, standard input,
whether stdout is a terminal and two write functions, and it returns an exit
code rather than calling `process.exit`. And the formatters are pure: they
return strings and write to nothing, so every line the tool can print is
reachable from a test.

## Why node:http and node:https rather than fetch

`fetch` is simpler but cannot supply what this tool reports:

- Redirects must be followed one hop at a time, so that the destination
  policy is re-checked and credentials dropped at each hop. `fetch` either
  follows the chain itself or refuses to follow at all.
- The socket is needed for the peer address, the negotiated protocol and
  cipher, and the certificate presented by the server.
- The response must be consumed as a stream so that the size limit is
  enforced before the body is in memory, rather than after.
- The DNS lookup must be replaced with a guarded one, which `node:http`
  accepts as a `lookup` option.

## The redirect loop

`send` in `core/transport.ts` runs a loop. Each iteration performs one hop and
returns the response together with a record of the hop: URL, method, status,
HTTP version, headers, `Location`, time to headers, peer and TLS details.

A response is a redirect when its status is 301, 302, 303, 307 or 308 and it
carries a `Location`. When it is, and redirects are still permitted:

1. The redirect budget is checked. Exceeding it raises `too-many-redirects`.
2. `Location` is resolved against the current URL. A value that is not a
   valid URL, or that names a scheme other than http or https, raises
   `invalid-redirect`.
3. The method is rewritten where the specification requires it: 303 turns
   anything but HEAD into GET, and 301 or 302 turns POST into GET. The body is
   dropped with the method, and `Content-Type` and `Content-Length` go with
   it.
4. If the next hop is a different origin — a different host or a different
   scheme — `Authorization`, `Cookie` and `Proxy-Authorization` are removed.
5. The loop repeats, which re-runs the destination check for the new address.

Otherwise the body is read, hashed and decoded, and the exchange is returned.
Hops that were redirects are kept in order; the last response is the final
one.

## Timing

Durations come from `process.hrtime.bigint()`, a monotonic clock, never from
the wall clock, which can move backwards. Three values are measured:

| Value       | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `totalMs`   | From the start of the first hop to the end of the body        |
| `headersMs` | From the start of the final hop to its headers being complete |
| `bodyMs`    | Transfer time of the final response body                      |

`redirectMs` is derived — total minus the final hop's headers and body — and
is `null` when there were no redirects.

DNS, TCP and TLS handshake phases are not reported. They cannot be separated
accurately through this interface, and an invented number is worse than an
absent one. The `inspect` report says so in its timing block rather than
leaving the omission to be discovered.

The same principle governs everything else in the report: a value the server
did not provide is printed as `not available` or `not declared`, never
inferred.

## Redaction

Redaction lives in `core/redact.ts` and is applied on the way out of the core,
not on the way into a formatter. A value that is never carried into a report
cannot be printed by a future formatter that forgot about it, and the same
functions serve terminal output, JSON output and the history file.

Three entry points:

- `redactHeaders` replaces the value of any header whose name is in the
  sensitive set.
- `redactUrl` replaces user information and the values of credential-shaped
  query parameters, preserving the structure so the request is still
  recognisable.
- `redactText` is a best-effort pass over free text, used for body previews.
  It is a safety net rather than a guarantee; see
  [security-model.md](security-model.md).

Error messages are held to the same rule: they never contain header values or
body content, because an error is printed, logged and pasted into issue
reports.

## Destination policy

Classification works on resolved addresses, not on the URL string. A name
resolves to an address, the address is what is connected to, and the two can
disagree — deliberately, in a DNS rebinding attack.

Enforcement has two parts:

- A guarded `lookup` function, built by `createGuardedLookup` and passed to
  `http.request`. It resolves the name with `all: true`, classifies every
  address returned, refuses the request if any of them is outside the policy
  and otherwise returns exactly those addresses to the agent. Because the
  agent connects to an address this function returned, there is no window in
  which a second resolution could substitute another.
- A literal-address check in `performHop`. A URL whose host is already an IP
  address never reaches the lookup function, so it is classified directly
  before the request is created. Without it `--restrict-destinations` would
  stop a name that resolves to `127.0.0.1` but not `127.0.0.1` written out.

Both run on every hop, so a redirect cannot escape the policy that the first
request was subject to. A bracketed IPv6 literal is unwrapped before either
step, so `http://[::1]:8080/` is classified as the address `::1` and the
brackets are stripped again before the connection is made.

Classification covers IPv4 and IPv6, including IPv4-mapped, IPv4-compatible
and NAT64 addresses, which are judged by the IPv4 address they carry. Cloud
instance metadata addresses are a named scope of their own, because a request
that reaches one is the most valuable result of a server-side request forgery.

## Testing

Tests run under Vitest in two projects:

- `unit` exercises pure logic and may run in parallel.
- `integration` runs the compiled binary as a child process against real
  temporary directories. Its files run one at a time, so concurrent fixtures
  cannot interfere through the process-wide working directory.

```sh
npm test                  # unit
npm run test:integration  # integration
npm run verify            # types, lint, format, both suites, build
```

The design supports this split: `run` returns an exit code and takes its
environment as an argument, formatters return strings, and the destination
guard accepts an injected resolver, so the awkward parts can be tested
without a network.

## Build and release

| Script                 | Effect                                        |
| ---------------------- | --------------------------------------------- |
| `npm run build`        | `tsc -p tsconfig.build.json`, `src` to `dist` |
| `npm run check`        | Type-check without emitting                   |
| `npm run lint`         | ESLint over the repository                    |
| `npm run format:check` | Prettier in check mode                        |
| `npm run verify`       | Everything above plus both test suites        |

The build emits JavaScript, declaration files and source maps into `dist`,
mirroring the layout of `src`. The executable is `dist/bin/requestlab.js`,
declared in `bin`, and the library entry point is `dist/index.js`, declared
in `exports`, `main` and `types`.

The package requires Node 20.19 or later and is distributed through GitHub
releases only; it is not published to a registry. The published file list is
`dist`, `README.md`, `CHANGELOG.md` and `LICENSE`. The release number lives in
`src/version.ts` as well as `package.json`, so that no file outside `dist`
has to be read at run time; the two must be changed together.
