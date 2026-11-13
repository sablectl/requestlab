# Troubleshooting

Each section below gives the message RequestLab prints, what it means and what
to do about it. Errors go to stderr in the form `error: <message>`, with a
hint indented on the next line where one exists. Reports go to stdout, so the
two streams can be separated.

## The request timed out

```text
error: The request did not complete within 30000 ms.
  Raise --timeout, or use --max-body-size if the body is large.
```

The overall deadline expired. It covers the whole exchange: every redirect,
the response headers and the body.

- Confirm the service is slow rather than stuck by raising the deadline:
  `--timeout 60000`.
- If the response is large, the time may be body transfer. Cap it with
  `--max-body-size 65536` and see whether the headers arrive promptly.
- Use `inspect` to see where the time goes: `To headers` against
  `Body transfer`.
- Make the change permanent with `requestlab config set timeoutMs 60000`.

A connection that is never accepted fails differently:

```text
error: No connection within 10000 ms.
  Raise --connect-timeout if the host is simply slow to accept.
```

Nothing accepted the connection within the connect deadline, which is
separate so that this case is distinguishable from a server that accepts and
then stalls. A silent firewall drop usually looks like this.

## The connection was refused

```console
$ requestlab send http://127.0.0.1:1/x
error: The connection failed (ECONNREFUSED).
```

Something answered the address and rejected the connection: nothing is
listening on that port, or the port is closed to you. Check that the service
is running, that it listens on the interface you addressed and that the port
in the URL is right. Other system-level failures appear in the same form with
their own code, for example `ECONNRESET` or `EHOSTUNREACH`, and
`The connection failed.` with no code when none was supplied.

## The host name could not be resolved

```console
$ requestlab send http://nonexistent.invalid/
error: The host name could not be resolved (ENOTFOUND).
  Check the host name and this machine’s DNS configuration.
```

`ENOTFOUND` means the name does not exist as far as this machine's resolver is
concerned; `EAI_AGAIN` means the resolver failed temporarily. Check the
spelling, check `/etc/hosts` and your resolver configuration, and remember
that a name private to a VPN will not resolve while the VPN is down.

A resolver that succeeds but returns nothing produces:

```text
error: example.internal did not resolve.
```

## The certificate was rejected

```console
$ requestlab send https://127.0.0.1:18212/
error: The server’s certificate was rejected: DEPTH_ZERO_SELF_SIGNED_CERT.
  RequestLab always verifies certificates and has no bypass.
```

The same message appears with `CERT_HAS_EXPIRED`,
`SELF_SIGNED_CERT_IN_CHAIN` or `ERR_TLS_CERT_ALTNAME_INVALID`. Other TLS
failures are reported as `TLS failed: <code>.`

There is no option that disables verification. Your choices are:

- Address the host by the name on the certificate, when the failure is
  `ERR_TLS_CERT_ALTNAME_INVALID`.
- Fix or renew the certificate.
- Trust the issuing authority in the process you start, using Node's own
  mechanism:

  ```sh
  NODE_EXTRA_CA_CERTS=/path/to/ca.pem requestlab inspect https://localhost:8443/
  ```

Use `inspect` to see what the server actually presented once the connection
can be made at all: subject, issuer, validity window, protocol and cipher.

## Too many redirects

```console
$ requestlab send http://127.0.0.1:18211/loop
error: More than 5 redirects were followed.
  Raise --max-redirects, or use --no-follow to stop at the first.
```

The chain exceeded the budget, usually because it is a loop.

- `--no-follow` reports the first response, so you can read its `Location`
  and status directly.
- `send -I` on each step shows where the chain goes.
- `--max-redirects 10` raises the budget for a legitimately long chain.

Related failures:

```text
error: The server sent a Location header that is not a valid URL.
error: The server redirected to an unsupported scheme ("ftp").
```

Both mean the chain cannot be followed further. Use `--no-follow` and inspect
the headers the server sent.

## The destination was refused

```console
$ requestlab send http://localhost:18211/api/health --restrict-destinations
error: localhost resolves to ::1, which is a loopback address, and destination restrictions are in force.
  Remove --restrict-destinations to allow requests to this network.
```

Destination restrictions are in force and the resolved address is not
globally routable. The scope is named in the message: loopback, private,
link-local, unique-local, multicast, unspecified, reserved or cloud instance
metadata.

- If the restriction was intended, the message is the answer: the address is
  not one you meant to reach.
- If you are debugging a local service, drop `--restrict-destinations`.
- If the restriction comes from the configuration file rather than the
  command line, there is no option that turns it off. Remove it with
  `requestlab config unset restrictDestinations`.

Note that a name can resolve to several addresses, and the request is refused
if any of them is outside the policy.

## The body was truncated

```console
$ requestlab send http://127.0.0.1:18211/big --max-body-size 100
HTTP/1.1 200 OK

Summary
  Size            100 B (truncated at the size limit)
```

Reading stopped at `maxBodyBytes`, 5 MiB by default, and the connection was
closed. The reported size and the SHA-256 digest describe the bytes that were
read, not the whole response, so a digest from a truncated read must not be
compared against one from a complete read.

Raise the limit with `--max-body-size`, or `requestlab config set
maxBodyBytes 20971520`, and remember that the body is held in memory.

A separate notice concerns the preview rather than the body:

```text
  … preview truncated. Use --preview to show more.
```

Here the whole body was read, but only the first 2048 characters were
printed. `--preview 20000` prints more and `--no-body` prints none.

## The body is not printed

```console
$ requestlab send http://127.0.0.1:18211/binary
HTTP/1.1 200 OK

Summary
  Size            2.0 KiB
  Total           16 ms

Body not shown: 2.0 KiB of binary content.
```

The content type is not one RequestLab treats as text. Text is `text/*` or a
type containing `json`, `xml`, `javascript` or `x-www-form-urlencoded`; a
response with no content type at all is treated as text. Anything else is
binary and is not decoded, because printing arbitrary bytes to a terminal
corrupts it.

The size and digest are still reported, and `inspect` gives the full
metadata. To keep the bytes, request the resource with a tool intended for
downloading.

`inspect` never prints a body, by design. Use `send` when you want to see
one.

## The body could not be read

```text
error: The response body could not be read (ECONNRESET).
```

The connection failed part way through the response. Retry, and if it is
reproducible look at the server: a response cut short mid-body is usually a
crash or a proxy timeout on the other side.

## There is no colour

Output that is piped or redirected is monochrome by default. This is
deliberate: colour codes in a file or in `grep` input are noise.

Check, in this order: `--no-color` on the command line, `NO_COLOR` set to
anything non-empty, `TERM=dumb`, `FORCE_COLOR`, then whether stdout is a
terminal. The first that applies decides.

To force colour through a pager:

```sh
FORCE_COLOR=1 requestlab inspect http://127.0.0.1:8080/ | less -R
```

Nothing is lost without colour: every status shown in colour is also stated
in words.

## The history is empty

```console
$ requestlab history
No history recorded.
```

History is off by default. Nothing is recorded unless `--save-history` was
given on the request or `historyEnabled` is set:

```sh
requestlab config set historyEnabled true
```

If you believe entries should exist, check that you are reading the same file
that was written:

```console
$ requestlab history path
/home/you/.local/state/requestlab/history.jsonl
```

`REQUESTLAB_STATE_DIR` and `XDG_STATE_HOME` both move that path, so a
variable set in one shell and not another explains a history that appears to
come and go. Entries also expire: `historyMaxAgeDays` drops old ones and
`historyMaxEntries` keeps only the most recent, both applied the next time an
entry is written.

If the file exists but cannot be read:

```text
error: The history file could not be read (EACCES).
```

Check the ownership and mode of the state directory. The tool expects to own
it, with mode `0700` on the directory and `0600` on the file.

## A configuration value is rejected

From the command line:

```console
$ requestlab config set timeoutMs abc
error: command line: "timeoutMs" must be a non-negative whole number.
```

From the file, where the path replaces `command line`:

```console
$ requestlab config show
error: /home/you/.config/requestlab/config.json: "timeoutMs" must be a non-negative whole number.
```

Numeric settings take non-negative whole numbers, booleans take `true` or
`false` and `userAgent` takes a non-empty string. The same validation runs
whether a value arrives from `config set` or from the file, so an invalid file
makes every command fail until it is fixed.

An unknown key:

```console
$ requestlab config set timeout 5000
error: "timeout" is not a known setting.
  Known settings: connectTimeoutMs, historyEnabled, historyMaxAgeDays, historyMaxEntries, maxBodyBytes, maxRedirects, restrictDestinations, timeoutMs, userAgent.
```

A file that is not JSON at all:

```console
$ requestlab send http://127.0.0.1:18211/
error: /home/you/.config/requestlab/config.json is not valid JSON.
```

Edit the file, or delete it and start again with `config set`. The location is
always available from `requestlab config path`.

## Usage errors

| Message                                                                  | Cause                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| `"notaurl" is not a valid absolute URL.`                                 | The URL has no scheme                              |
| `The scheme "ftp" is not supported.`                                     | Only http and https are spoken                     |
| `Unknown option "--verbose".`                                            | No such option                                     |
| `Option "--timeout" needs a value.`                                      | A value-taking option was last on the line         |
| `Option "--fail" does not take a value.`                                 | `--fail=yes` instead of `--fail`                   |
| `Option "--timeout" must be a non-negative whole number, not "1.5".`     | A fraction, a negative or a non-number             |
| `"foo" is not a query parameter.`                                        | `--query` needs `name=value`                       |
| `"Bad Name" is not a valid header name.`                                 | A space or other illegal character in a name       |
| `"x" is not a header.`                                                   | `--header` needs `Name: value`                     |
| `A request body cannot be sent with GET.`                                | A body with GET or HEAD                            |
| `Give at most one of --data, --json-body, --data-file and --data-stdin.` | More than one body source                          |
| `Use either --bearer-env or --basic-env, not both.`                      | Two authentication options                         |
| `Environment variable API_TOKEN is not set.`                             | The named variable is unset or empty               |
| `Environment variable CREDS must hold user:password.`                    | `--basic-env` value has no colon                   |
| `/path cannot be read.`                                                  | `--data-file` names an unreadable path             |
| `The JSON body is not valid JSON: …`                                     | `--json-body` was given something that is not JSON |
| `"frobnicate" is not a requestlab command.`                              | No such command                                    |

All of these exit `2`. Run `requestlab <command> --help` for the options a
command accepts.

## Something else went wrong

```text
internal error: <message>
  This is a defect. Please report it at https://github.com/sablectl/requestlab/issues
```

An error reached the entry point that was not one of the failures above. It
exits `3` and is a defect in the tool. Please report it with the command you
ran, with any secrets removed.
