# Security model

RequestLab is a local command-line tool. It performs the requests you ask for
from your own machine, under your own account. This document states what that
protects against, what it does not and why the boundaries fall where they do.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Trust model

The person running the command is trusted. They already have the privileges of
their shell, so the tool does not try to defend the machine from its operator:
there is no sandbox around `--data-file`, no restriction on which paths may be
read and no attempt to limit which hosts may be named by default.

What is not trusted is the network: the server that answers, the names that
resolve, the redirects that come back and the bytes that arrive. Everything
the tool does with those inputs assumes they may be hostile.

The host the request is made to is also not trusted with credentials beyond
its own origin, which is why credentials are dropped across a redirect.

## What is protected against

- Sending credentials to an origin you did not address.
- Printing or storing credentials you supplied, in reports, in the history
  and in error messages.
- Being redirected out of a restricted destination policy.
- A name that resolves to an address the policy forbids, including a name
  that resolved harmlessly a moment earlier.
- A server that answers slowly, never, endlessly or with an unbounded body.
- A server that presents an invalid certificate.

## What is not protected against

- An operator who chooses to send a request anywhere, which is the ordinary
  use of the tool.
- A credential written directly on the command line.
- A secret inside a response body, which can take any shape.
- Anything already able to read your files or your process memory.
- The confidentiality of plain HTTP, which is unencrypted by definition.

## Destination restrictions

By default any destination is allowed. Debugging a service on `127.0.0.1` is
the ordinary case, and a local tool that refused to do it would be useless.

`--restrict-destinations`, or `restrictDestinations` in the configuration
file, refuses anything that is not globally routable. The scopes recognised
are loopback, private, link-local, unique-local, multicast, unspecified,
reserved and cloud-metadata. Metadata addresses are named separately —
`169.254.169.254`, `169.254.170.2`, `100.100.100.200` and `fd00:ec2::254` —
because a request that reaches one is the single most valuable result of a
server-side request forgery.

```console
$ requestlab send http://127.0.0.1:18211/api/health --restrict-destinations
error: 127.0.0.1 resolves to 127.0.0.1, which is a loopback address, and destination restrictions are in force.
  Remove --restrict-destinations to allow requests to this network.
```

The restriction is per invocation. There is no option that turns it off once
the setting is on; remove the setting instead.

### Why URL validation does not prevent SSRF

Inspecting the URL string answers the wrong question. The string names a
host; the request goes to an address. A name can resolve to anything,
including a loopback or metadata address, and the resolution can change
between the moment a check is made and the moment a socket is opened. An
allowlist of host names, a regular expression over the URL or a rejection of
`localhost` all leave that gap open.

RequestLab therefore classifies resolved addresses and makes the decision at
the point where the connection is made. This narrows a well-known class of
attack. It is not a claim that RequestLab prevents server-side request
forgery in general, and this project does not make that claim.

### DNS rebinding and the connection boundary

The guard is installed as the `lookup` function the HTTP agent itself calls.
It resolves the name, classifies every address returned, refuses the request
if any of them is outside the policy and otherwise hands back exactly those
addresses. The agent connects to an address the guard approved, so there is
no second resolution that could return something else in between.

A URL whose host is already an IP address never reaches the lookup function
at all, so it is classified directly before the request is created. Both
paths are covered.

### Redirects

Every hop repeats the whole procedure: the destination of the new URL is
classified and checked before a socket is opened. A server cannot answer a
permitted request with a redirect into a forbidden network.

Redirects to a scheme other than http or https are refused outright.

## Credentials

### Where they come from

`--bearer-env VARIABLE` and `--basic-env VARIABLE` read the credential from
an environment variable. This is the recommended way to supply one:

```sh
export API_TOKEN=…
requestlab send https://api.example.com/items --bearer-env API_TOKEN
```

A secret written directly on the command line, as `--header "Authorization:
Bearer …"`, is visible in process listings to every other process on the
machine and is written to your shell history file. The command-line help says
so. The environment variable options exist because of it.

An environment variable is not perfect either: it is readable by the
processes you start and, on some systems, inspectable by your own other
processes. It is better than an argument, not beyond reach.

### Redaction

Redaction happens on the way out of the core, before anything is formatted or
written, so the same rule governs the terminal, the JSON report and the
history file.

Covered:

- Header values whose name is `authorization`, `proxy-authorization`,
  `cookie`, `set-cookie`, `x-api-key`, `api-key`, `apikey`, `x-auth-token`,
  `x-authentication-token`, `x-access-token`, `x-session-token`,
  `x-csrf-token`, `x-xsrf-token`, `x-amz-security-token`, `x-goog-api-key`,
  `authentication`, `www-authenticate` or `proxy-authenticate`.
- User information in a URL.
- Values of credential-shaped query parameters, including `access_token`,
  `api_key`, `auth`, `client_secret`, `code`, `id_token`, `key`, `password`,
  `refresh_token`, `secret`, `session`, `sig`, `signature` and `token`.

```console
$ requestlab inspect "http://127.0.0.1:18211/api/health?api_key=abcdef" --bearer-env TOK
HTTP/1.1 200 OK

Request
  Method          GET
  URL             http://127.0.0.1:18211/api/health?api_key=%5Bredacted%5D
  Authorization: [redacted]
  User-Agent: requestlab/1.0.0
  Accept: */*
```

The structure survives redaction, so the report still shows which request was
made.

### Limits of redaction

Response body previews are passed through a best-effort filter that replaces
credential-shaped substrings: `Bearer`, `Basic` and `token` followed by a long
opaque value, and anything shaped like a JSON Web Token. A body can carry a
secret in any shape, and no filter can recognise all of them. Request bodies
are never printed back at all; only their size and source are reported.

`--no-body`, or `--preview 0`, is the only way to be certain that no body
content is printed. `inspect` never prints a body. The history never stores
one.

A header not in the list above is printed in full. If your service carries a
credential in a header of its own invention, redaction will not know about
it.

### Credentials across origins

When a redirect crosses to another host or another scheme,
`Authorization`, `Cookie` and `Proxy-Authorization` are removed before the
next hop is made. A server cannot collect a token by redirecting you
elsewhere.

## Resource limits

| Limit                           | Default  | Effect                                         |
| ------------------------------- | -------- | ---------------------------------------------- |
| Connect timeout                 | 10000 ms | A host that never accepts is abandoned         |
| Overall timeout                 | 30000 ms | The whole exchange, redirects included         |
| Response size cap               | 5 MiB    | Reading stops and the body is marked truncated |
| Redirect cap                    | 5        | The chain is refused beyond this               |
| Request body from file or stdin | 32 MiB   | Refused above this                             |

The two timeouts are separate so that a host which accepts but never answers
is reported differently from one that never accepts at all.

Memory is bounded by the response size cap, which is enforced while the body
streams in rather than after it has arrived: the read stops at the limit and
the connection is destroyed. Raising `maxBodyBytes` raises the memory the
tool may use.

## Transport security

Certificate verification is always on. There is no flag, setting or
environment variable in RequestLab that disables it, and a rejected
certificate is a failed request:

```console
$ requestlab send https://127.0.0.1:18212/
error: The server’s certificate was rejected: DEPTH_ZERO_SELF_SIGNED_CERT.
  RequestLab always verifies certificates and has no bypass.
```

`inspect` reports the negotiated protocol, the cipher, whether the peer was
authorised and the certificate's subject, issuer and validity window, so a
chain can be examined without weakening it.

Trust comes from Node.js, so the usual Node mechanisms for adding a
certificate authority apply to the process you start. That is a decision
about your machine, not a bypass inside the tool.

## History and telemetry

- History is off until `historyEnabled` is set or `--save-history` is given.
- It is stored only on this machine, under the state directory.
- The directory is created with mode `0700` and the file with mode `0600`.
- Entries are redacted before they are written, not before they are
  displayed: a credential that never reaches the file cannot leak from it.
- Request and response bodies are never recorded. Only their size and the
  response digest are kept.
- Retention is bounded by `historyMaxEntries` and `historyMaxAgeDays`.
- `requestlab history clear` removes every entry.

RequestLab collects no telemetry, performs no update checks and contacts no
address other than the one you give it. It has no runtime dependencies, so
nothing else runs inside the process either.

## Non-guarantees

The following are explicitly not promised:

- Not a general defence against server-side request forgery. Destination
  restrictions narrow one class of attack; they are not a complete control
  for a service that forwards untrusted URLs.
- Not a secrets manager. Credentials are read from the environment, used and
  redacted from output; they are not stored, rotated or protected at rest.
- No guarantee that a body preview is free of secrets. The filter is best
  effort.
- No defence against an attacker who already controls the machine, the
  account or the environment the tool runs in.
- No protection for data in transit over plain HTTP.
- No audit log. The history is a convenience and can be cleared or removed by
  anyone who can run the tool as you.
- No supply-chain guarantee beyond the published GitHub releases. This
  package is not on npm; a registry package of this name is not this project.
- No claim of correct behaviour on untested platforms. Development and CI are
  on Linux; macOS and Windows are untested.
