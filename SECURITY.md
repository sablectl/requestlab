# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

Security fixes are made against the latest release in the supported line.

## Reporting a vulnerability

Please do not report security vulnerabilities through public issues, pull
requests or discussions.

Report them privately using GitHub Security Advisories for this repository:

1. Open <https://github.com/sablectl/requestlab/security/advisories/new>
   (the "Report a vulnerability" button on the repository's Security tab).
2. Describe the problem, the affected version, and steps to reproduce it. A
   minimal command line and a small local server that triggers the behaviour
   is the most useful thing to include.
3. State what you believe the impact to be.

Never include a real credential, token or capture of production traffic in a
report.

You can expect an acknowledgement of your report, and a follow-up once it has
been assessed. Please allow reasonable time for a fix before any public
disclosure. Reporters are credited in the advisory unless they prefer
otherwise.

## What counts as a vulnerability

Examples of issues that are in scope:

- A credential reaching standard output, standard error or the history file
  without being redacted.
- A way past the destination restrictions when `--restrict-destinations` or
  `restrictDestinations` is in force — including through a redirect, a DNS
  answer that changes between the check and the connection, an alternative
  address representation, or an IPv6 form of a restricted IPv4 address.
- A request that completes despite a certificate that should have been
  rejected.
- A response that causes unbounded memory use despite `maxBodyBytes`, or a
  request that outlives its deadline.
- A redirect that carries `Authorization`, `Cookie` or
  `Proxy-Authorization` to a different origin.
- A configuration file, history file or server response that causes the tool
  to write outside the directories it is documented to write to.
- Terminal output manipulation through crafted header values or bodies.

## What does not count

- Reaching loopback or a private network **without** destination restrictions
  in force. That is the documented default for a local debugging tool; see
  [docs/security-model.md](docs/security-model.md).
- A secret becoming visible because it was written directly on the command
  line. Process arguments are readable by other processes on most systems and
  are kept in shell history. Use `--bearer-env` or `--basic-env`.
- A secret appearing in a response body preview in a shape the best-effort
  body redaction does not recognise. This limit is documented; `--no-body` is
  the way to be certain nothing is printed.
- Behaviour of the server being inspected.
- Findings that require an attacker who already controls the machine running
  RequestLab or the account's files.

## Security properties

RequestLab verifies TLS certificates on every HTTPS request and provides no
option to disable verification. It performs no background network activity,
collects no telemetry, follows no link it was not given, and reads no
credential it was not pointed at. Destination restrictions are enforced on
resolved addresses at the connection boundary rather than by inspecting the
URL string, and are re-applied to every redirect.

The full threat model, including the guarantees this project does **not**
make, is in [docs/security-model.md](docs/security-model.md).
