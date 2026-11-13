# Contributing

Thank you for considering a contribution to RequestLab. This document
describes how to set up a working tree and what is expected of a change.

## Ground rules

- RequestLab talks to untrusted servers and handles credentials. Correctness
  and honesty about what the tool does and does not protect against matter
  more than features.
- The tool has **zero runtime dependencies**. Please do not add any.
  Development dependencies are acceptable where they are justified.
- Documentation and behaviour must agree. A change that alters a flag, a
  default, an exit code or the JSON envelope must update the relevant document
  in `docs/` and `CHANGELOG.md` in the same pull request.
- Do not claim in documentation or comments anything the code does not do.
- Security vulnerabilities must not be reported through public issues. See
  [SECURITY.md](SECURITY.md).

## Development setup

Node.js 20.19 or later is required.

```sh
git clone https://github.com/sablectl/requestlab.git
cd requestlab
npm ci
npm run build
```

Run the built CLI with:

```sh
node dist/bin/requestlab.js --help
```

## Checks

```sh
npm run check            # TypeScript, no emit
npm run lint             # ESLint, type-aware
npm run format:check     # Prettier
npm test                 # unit tests
npm run test:integration # integration tests
npm run build            # production build

npm run verify           # all of the above, in order
```

`npm run verify` must pass before a pull request is opened, and it is what CI
runs on Node 20.19, 22 and 24.

## Tests

- New behaviour needs a test that would fail without it.
- Tests never contact a third-party host. Integration tests start their own
  HTTP server on `127.0.0.1` with an ephemeral port.
- Tests never write to the real configuration or history. Point
  `REQUESTLAB_CONFIG` and `REQUESTLAB_STATE_DIR` at a temporary directory and
  remove it afterwards.
- `run(io)` returns an exit code and takes its streams and environment as
  arguments, so a command can be exercised in process rather than by spawning
  one.

## Code conventions

- Strict TypeScript. The compiler options in `tsconfig.json` are not relaxed
  for convenience.
- The core never imports from `cli/` or `output/`. Transport logic and
  presentation stay separate.
- Untrusted input — a URL, a header, a configuration file, a server response —
  is parsed and validated, never asserted into a type.
- Credentials are redacted on the way out of the core, so that a new formatter
  cannot print something an old one hid.
- Error messages are written for the person who ran the command, and must
  never contain a header value, a body or anything else that could carry a
  secret.
- Prose in comments and documentation uses British English.

## Commits and pull requests

- One logical change per pull request.
- Conventional commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Describe what changed and why, and state which checks you ran.
- Never include a token, a credential or a capture of real traffic. This
  repository is public.
