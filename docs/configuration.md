# Configuration

RequestLab runs without configuration. A configuration file exists only once
you write one with `requestlab config set`, and every setting has a built-in
default until then.

## Precedence

For any value that both a command-line option and a setting can supply, the
order is:

1. The command-line option.
2. The configuration file.
3. The built-in default.

There is no environment variable that changes a setting. The environment only
selects where the configuration and state live, and whether colour is used.

## File location

| Source                                    | Used when                                     |
| ----------------------------------------- | --------------------------------------------- |
| `REQUESTLAB_CONFIG`                       | Set and non-empty. Used as the full file path |
| `$XDG_CONFIG_HOME/requestlab/config.json` | `XDG_CONFIG_HOME` is set and non-empty        |
| `~/.config/requestlab/config.json`        | Otherwise                                     |

```console
$ requestlab config path
/home/you/.config/requestlab/config.json
```

`REQUESTLAB_CONFIG` names a file, not a directory, which makes it convenient
for a test or a one-off profile:

```sh
REQUESTLAB_CONFIG=/tmp/profile.json requestlab config show
```

## File format and permissions

The file is a JSON object whose keys are setting names. Only the settings you
changed are stored; the rest come from the defaults.

```json
{
  "timeoutMs": 5000
}
```

Writes go to a temporary file in the same directory and are then renamed, so
the file is never seen half-written. The directory is created with mode
`0700` and the file with mode `0600`:

```console
$ ls -l ~/.config/requestlab/config.json
-rw-------. 1 you you 24 Nov 13 12:27 /home/you/.config/requestlab/config.json
```

An unknown key is an error rather than being ignored, so a typo is reported
instead of silently doing nothing.

## Settings

| Setting                | Type    | Default            | Valid values              | Effect                                                                                                                   |
| ---------------------- | ------- | ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `timeoutMs`            | number  | 30000              | Non-negative whole number | Deadline for the whole exchange, redirects and body included. Overridden by `--timeout`                                  |
| `connectTimeoutMs`     | number  | 10000              | Non-negative whole number | Deadline for establishing one connection. Overridden by `--connect-timeout`                                              |
| `maxRedirects`         | number  | 5                  | Non-negative whole number | Redirects followed before the request is refused. `0` follows none. Overridden by `--max-redirects` and by `--no-follow` |
| `maxBodyBytes`         | number  | 5242880            | Non-negative whole number | Response bytes read before the body is truncated. Overridden by `--max-body-size`                                        |
| `userAgent`            | string  | `requestlab/1.0.0` | Non-empty string          | Default `User-Agent` header. Overridden by `--user-agent` or by an explicit `--header`                                   |
| `restrictDestinations` | boolean | false              | `true` or `false`         | Refuse non-global destinations. `--restrict-destinations` turns it on; there is no option that turns it off              |
| `historyEnabled`       | boolean | false              | `true` or `false`         | Record every request in the local history. `--save-history` records one request without it                               |
| `historyMaxEntries`    | number  | 200                | Non-negative whole number | Entries retained. `0` keeps nothing                                                                                      |
| `historyMaxAgeDays`    | number  | 30                 | Non-negative whole number | Entries older than this are dropped on the next write                                                                    |

A numeric setting must be a non-negative whole number: no fractions, no
negatives, no infinities. A boolean must be `true` or `false`, accepted either
as a JSON boolean in the file or as the string on the command line. Retention
is applied by age first and then by count, each time an entry is written.

A timeout of `0` is accepted and schedules the deadline immediately, which
aborts the request; use a realistic value rather than `0` to mean "no limit".

## Inspecting and changing settings

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

Set a value:

```console
$ requestlab config set timeoutMs 5000
timeoutMs set in /home/you/.config/requestlab/config.json.
$ requestlab config show
/home/you/.config/requestlab/config.json

  connectTimeoutMs      10000 (default)
  historyEnabled        false (default)
  historyMaxAgeDays     30 (default)
  historyMaxEntries     200 (default)
  maxBodyBytes          5242880 (default)
  maxRedirects          5 (default)
  restrictDestinations  false (default)
  timeoutMs             5000
  userAgent             requestlab/1.0.0 (default)
```

A value from the file is printed without the `(default)` marker.

Turn the history on:

```console
$ requestlab config set historyEnabled true
historyEnabled set in /home/you/.config/requestlab/config.json.
```

Remove a key and return to the default:

```console
$ requestlab config unset timeoutMs
timeoutMs removed from /home/you/.config/requestlab/config.json.
```

`unset` is harmless when the key is not present: the file is rewritten without
it.

An invalid value is refused and nothing is written:

```console
$ requestlab config set timeoutMs abc
error: command line: "timeoutMs" must be a non-negative whole number.
```

An unknown key is refused and the known ones are listed:

```console
$ requestlab config set timeout 5000
error: "timeout" is not a known setting.
  Known settings: connectTimeoutMs, historyEnabled, historyMaxAgeDays, historyMaxEntries, maxBodyBytes, maxRedirects, restrictDestinations, timeoutMs, userAgent.
```

Machine-readable output is available on this command:

```sh
requestlab config show --json
```

The envelope and the `result` shape are described in
[commands.md](commands.md#json-output).

## State directory

The request history is state, not configuration, and lives in its own
directory.

| Source                       | Used when                                |
| ---------------------------- | ---------------------------------------- |
| `REQUESTLAB_STATE_DIR`       | Set and non-empty. Used as the directory |
| `$XDG_STATE_HOME/requestlab` | `XDG_STATE_HOME` is set and non-empty    |
| `~/.local/state/requestlab`  | Otherwise                                |

The history file is `history.jsonl` inside that directory:

```console
$ requestlab history path
/home/you/.local/state/requestlab/history.jsonl
```

The directory is created with mode `0700` and the file with mode `0600`, and
it is written through the same temporary-file-and-rename sequence as the
configuration.

## Colour

Colour is decoration: every status reported in colour is also stated in
words, so monochrome output loses nothing, and output that is piped is
byte-identical whichever setting suppressed the colour.

| Input         | Effect                                                 |
| ------------- | ------------------------------------------------------ |
| `--no-color`  | Colour off                                             |
| `NO_COLOR`    | Colour off when set to any non-empty value             |
| `TERM=dumb`   | Colour off                                             |
| `FORCE_COLOR` | Colour on when set to a non-empty value other than `0` |
| TTY detection | Colour on when stdout is a terminal                    |

Precedence runs top to bottom: the first input that applies decides, so
`--no-color` beats `NO_COLOR`, which beats `TERM=dumb`, which beats
`FORCE_COLOR`, which beats TTY detection.

```sh
NO_COLOR=1 requestlab inspect http://127.0.0.1:8080/
FORCE_COLOR=1 requestlab send http://127.0.0.1:8080/ | less -R
```

## Environment variables

| Variable               | Effect                                                    |
| ---------------------- | --------------------------------------------------------- |
| `REQUESTLAB_CONFIG`    | Full path of the configuration file                       |
| `REQUESTLAB_STATE_DIR` | Directory holding the history file                        |
| `XDG_CONFIG_HOME`      | Base for `requestlab/config.json` when the above is unset |
| `XDG_STATE_HOME`       | Base for `requestlab/` state when the above is unset      |
| `NO_COLOR`             | Disable colour                                            |
| `FORCE_COLOR`          | Enable colour when the output is not a terminal           |
| `TERM`                 | `dumb` disables colour                                    |

Variables named by `--bearer-env` and `--basic-env` are read for their
credential and are never printed. Proxy variables such as `HTTP_PROXY` are
ignored; see [technical-debt.md](technical-debt.md).
