// Command dispatch.
//
// `run` takes its environment as an argument and returns an exit code. It
// never calls `process.exit`, so the whole command surface is testable in
// process.

import { compareExchanges } from '../core/compare.js';
import {
  DEFAULT_SETTINGS,
  isSettingKey,
  loadSettings,
  loadStoredPatch,
  parseSettings,
  saveSettings,
  SETTING_KEYS,
  configPath,
  type Settings,
} from '../core/config.js';
import {
  type AppError,
  ExitCode,
  isAppError,
  usageError,
} from '../core/errors.js';
import type { ExitCodeValue } from '../core/errors.js';
import {
  appendHistory,
  clearHistory,
  entryFromExchange,
  entryFromFailure,
  historyPath,
  readHistory,
} from '../core/history.js';
import { send as performRequest } from '../core/transport.js';
import type { Exchange } from '../core/types.js';
import { createPainter, shouldUseColour } from '../output/colour.js';
import type { Painter } from '../output/colour.js';
import {
  formatComparison,
  formatHistory,
  formatInspect,
  formatSend,
} from '../output/human.js';
import { comparisonToJson, envelope, exchangeToJson } from '../output/json.js';
import { VERSION } from '../version.js';
import {
  boolOf,
  listOf,
  numberOf,
  parseArgs,
  type OptionSpec,
  type ParsedArgs,
} from './args.js';
import {
  COMPARE_OPTIONS,
  GLOBAL_OPTIONS,
  SECURITY_NOTE,
  SEND_OUTPUT_OPTIONS,
  commandHelp,
  rootHelp,
  versionLine,
} from './help.js';
import { REQUEST_OPTIONS, buildRequest } from './request-options.js';

export interface Io {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdoutIsTty: boolean;
  write(text: string): void;
  writeError(text: string): void;
  readonly signal?: AbortSignal;
}

const COMMANDS = ['send', 'inspect', 'compare', 'history', 'config'] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/**
 * Combine option tables, refusing a name defined twice.
 *
 * A silent overwrite here once made `--json` mean a request body on three
 * commands and a report flag on the others. A collision is a defect, so it
 * fails loudly rather than choosing a winner.
 */
function merge(
  ...tables: readonly Readonly<Record<string, OptionSpec>>[]
): Readonly<Record<string, OptionSpec>> {
  const merged: Record<string, OptionSpec> = {};
  for (const table of tables) {
    for (const [name, spec] of Object.entries(table)) {
      if (name in merged) {
        throw new Error(`Option "--${name}" is defined by two option tables.`);
      }
      merged[name] = spec;
    }
  }
  return merged;
}

function painterFor(args: ParsedArgs, io: Io): Painter {
  return createPainter(
    shouldUseColour({
      noColorFlag: boolOf(args, 'no-color'),
      env: io.env,
      isTty: io.stdoutIsTty,
    }),
  );
}

function reportError(error: AppError, io: Io, painter: Painter): void {
  io.writeError(`${painter('error', 'red')}: ${error.message}\n`);
  if (error.hint !== undefined) {
    io.writeError(`  ${painter(error.hint, 'dim')}\n`);
  }
}

async function recordHistory(
  settings: Settings,
  io: Io,
  entry: ReturnType<typeof entryFromExchange>,
): Promise<void> {
  await appendHistory(
    entry,
    {
      maxEntries: settings.historyMaxEntries,
      maxAgeDays: settings.historyMaxAgeDays,
    },
    io.env,
  );
}

async function runRequestCommand(
  command: 'send' | 'inspect',
  argv: readonly string[],
  io: Io,
): Promise<ExitCodeValue> {
  const specs = merge(GLOBAL_OPTIONS, REQUEST_OPTIONS, SEND_OUTPUT_OPTIONS);
  const args = parseArgs(argv, specs);
  const painter = painterFor(args, io);

  if (boolOf(args, 'help')) {
    io.write(
      commandHelp(
        command,
        `requestlab ${command} <url> [options]`,
        command === 'send'
          ? 'perform a request and report the response'
          : 'perform a request and report everything that was measured',
        [
          ['Request options', REQUEST_OPTIONS],
          ['Output options', SEND_OUTPUT_OPTIONS],
          ['Global options', GLOBAL_OPTIONS],
        ],
        SECURITY_NOTE,
      ),
    );
    return ExitCode.Success;
  }

  const [url, ...extra] = args.positional;
  if (url === undefined) {
    throw usageError(`${command} needs a URL.`, `requestlab ${command} <url>`);
  }
  if (extra.length > 0) {
    throw usageError(
      `${command} takes one URL, but ${args.positional.length} were given.`,
    );
  }

  const { settings } = await loadSettings(io.env);
  const { spec } = await buildRequest(url, args, {
    settings,
    env: io.env,
    stdin: io.stdin,
  });

  const previewChars =
    command === 'inspect'
      ? 0
      : boolOf(args, 'no-body')
        ? 0
        : numberOf(args, 'preview', 2048);

  const saveHistory = boolOf(args, 'save-history') || settings.historyEnabled;
  const startedAt = new Date().toISOString();

  let exchange: Exchange;
  try {
    exchange = await performRequest(spec, {
      previewChars,
      ...(io.signal === undefined ? {} : { signal: io.signal }),
    });
  } catch (error) {
    if (saveHistory && isAppError(error)) {
      await appendHistory(
        entryFromFailure(
          spec.method,
          spec.url,
          startedAt,
          spec.headers,
          error.message,
        ),
        {
          maxEntries: settings.historyMaxEntries,
          maxAgeDays: settings.historyMaxAgeDays,
        },
        io.env,
      );
    }
    throw error;
  }

  if (saveHistory) {
    await recordHistory(settings, io, entryFromExchange(exchange));
  }

  if (boolOf(args, 'json')) {
    io.write(
      `${JSON.stringify(
        envelope(
          command,
          VERSION,
          'ok',
          exchangeToJson(exchange, previewChars > 0),
        ),
        null,
        2,
      )}\n`,
    );
  } else if (command === 'inspect') {
    io.write(`${formatInspect(exchange, painter)}\n`);
  } else if (boolOf(args, 'quiet')) {
    if (exchange.body.preview !== null && previewChars > 0) {
      io.write(`${exchange.body.preview}\n`);
    }
  } else {
    io.write(
      `${formatSend(exchange, painter, {
        showRequestHeaders: boolOf(args, 'show-request'),
        showResponseHeaders:
          boolOf(args, 'show-headers') || boolOf(args, 'show-request'),
        showBody: previewChars > 0,
      })}\n`,
    );
  }

  if (boolOf(args, 'fail') && exchange.final.status >= 400) {
    return ExitCode.Failure;
  }
  return ExitCode.Success;
}

async function runCompare(
  argv: readonly string[],
  io: Io,
): Promise<ExitCodeValue> {
  const specs = merge(GLOBAL_OPTIONS, REQUEST_OPTIONS, COMPARE_OPTIONS);
  const args = parseArgs(argv, specs);
  const painter = painterFor(args, io);

  if (boolOf(args, 'help')) {
    io.write(
      commandHelp(
        'compare',
        'requestlab compare <url> <url> [options]',
        'perform two requests and report the differences',
        [
          ['Comparison options', COMPARE_OPTIONS],
          ['Request options', REQUEST_OPTIONS],
          ['Global options', GLOBAL_OPTIONS],
        ],
        'Timing is reported but never counted as a difference.',
      ),
    );
    return ExitCode.Success;
  }

  const [left, right, ...extra] = args.positional;
  if (left === undefined || right === undefined || extra.length > 0) {
    throw usageError(
      'compare needs exactly two URLs.',
      'requestlab compare <url> <url>',
    );
  }

  const { settings } = await loadSettings(io.env);
  const context = { settings, env: io.env, stdin: io.stdin };
  const leftRequest = await buildRequest(left, args, context);
  const rightRequest = await buildRequest(right, args, context);

  const options = {
    previewChars: 0,
    ...(io.signal === undefined ? {} : { signal: io.signal }),
  };
  // Sequential, not concurrent: two requests sharing the machine's network
  // would distort the timings this command reports.
  const leftExchange = await performRequest(leftRequest.spec, options);
  const rightExchange = await performRequest(rightRequest.spec, options);

  const onlyHeaders = listOf(args, 'only-header');
  const comparison = compareExchanges(leftExchange, rightExchange, {
    ignoreHeaders: listOf(args, 'ignore-header'),
    ...(onlyHeaders.length === 0 ? {} : { onlyHeaders }),
    ignoreVolatile: !boolOf(args, 'no-ignore-volatile'),
    compareBody: !boolOf(args, 'no-body-compare'),
  });

  if (boolOf(args, 'json')) {
    io.write(
      `${JSON.stringify(
        envelope(
          'compare',
          VERSION,
          comparison.identical ? 'ok' : 'different',
          comparisonToJson(comparison, leftExchange, rightExchange),
        ),
        null,
        2,
      )}\n`,
    );
  } else if (!boolOf(args, 'quiet')) {
    io.write(
      `${formatComparison(comparison, leftExchange, rightExchange, painter)}\n`,
    );
  }

  return comparison.identical ? ExitCode.Success : ExitCode.Failure;
}

const HISTORY_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  limit: {
    kind: 'string',
    short: 'n',
    valueName: 'N',
    describe: 'Show at most this many of the most recent entries',
  },
};

async function runHistory(
  argv: readonly string[],
  io: Io,
): Promise<ExitCodeValue> {
  const args = parseArgs(argv, merge(GLOBAL_OPTIONS, HISTORY_OPTIONS));
  const painter = painterFor(args, io);

  if (boolOf(args, 'help')) {
    io.write(
      commandHelp(
        'history',
        'requestlab history [list|clear|path] [options]',
        'inspect the local request history',
        [
          ['History options', HISTORY_OPTIONS],
          ['Global options', GLOBAL_OPTIONS],
        ],
        'History is off until historyEnabled is set or --save-history is used.\n  ' +
          'Credentials are redacted before anything is written, and bodies are\n  ' +
          'never stored.',
      ),
    );
    return ExitCode.Success;
  }

  const action = args.positional[0] ?? 'list';
  if (args.positional.length > 1) {
    throw usageError('history takes one subcommand at most.');
  }

  if (action === 'path') {
    io.write(`${historyPath(io.env)}\n`);
    return ExitCode.Success;
  }

  if (action === 'clear') {
    const removed = await clearHistory(io.env);
    if (!boolOf(args, 'quiet')) {
      io.write(
        `Removed ${removed} entr${removed === 1 ? 'y' : 'ies'} from ${historyPath(
          io.env,
        )}.\n`,
      );
    }
    return ExitCode.Success;
  }

  if (action !== 'list') {
    throw usageError(
      `"${action}" is not a history subcommand.`,
      'Use list, clear or path.',
    );
  }

  const all = await readHistory(io.env);
  const limit = numberOf(args, 'limit', 0);
  const entries = limit === 0 ? all : all.slice(-limit);

  if (boolOf(args, 'json')) {
    io.write(
      `${JSON.stringify(
        envelope('history', VERSION, 'ok', {
          path: historyPath(io.env),
          count: entries.length,
          entries,
        }),
        null,
        2,
      )}\n`,
    );
  } else {
    io.write(`${formatHistory(entries, painter)}\n`);
  }
  return ExitCode.Success;
}

async function runConfig(
  argv: readonly string[],
  io: Io,
): Promise<ExitCodeValue> {
  const args = parseArgs(argv, GLOBAL_OPTIONS);

  if (boolOf(args, 'help')) {
    io.write(
      commandHelp(
        'config',
        'requestlab config [show|path|set <key> <value>|unset <key>]',
        'inspect and change stored settings',
        [['Global options', GLOBAL_OPTIONS]],
        `Settings: ${SETTING_KEYS.join(', ')}.`,
      ),
    );
    return ExitCode.Success;
  }

  const [action = 'show', key, value] = args.positional;

  if (action === 'path') {
    io.write(`${configPath(io.env)}\n`);
    return ExitCode.Success;
  }

  if (action === 'show') {
    const { settings, path, exists } = await loadSettings(io.env);
    if (boolOf(args, 'json')) {
      io.write(
        `${JSON.stringify(
          envelope('config', VERSION, 'ok', { path, exists, settings }),
          null,
          2,
        )}\n`,
      );
      return ExitCode.Success;
    }
    const lines = [`${path}${exists ? '' : ' (not written yet)'}`, ''];
    for (const name of SETTING_KEYS) {
      const current = settings[name];
      const isDefault = current === DEFAULT_SETTINGS[name];
      lines.push(
        `  ${name.padEnd(22)}${String(current)}${isDefault ? ' (default)' : ''}`,
      );
    }
    io.write(`${lines.join('\n')}\n`);
    return ExitCode.Success;
  }

  if (action === 'set') {
    if (key === undefined || value === undefined) {
      throw usageError('set needs a key and a value.');
    }
    if (!isSettingKey(key)) {
      throw usageError(
        `"${key}" is not a known setting.`,
        `Known settings: ${SETTING_KEYS.join(', ')}.`,
      );
    }
    const patch = await loadStoredPatch(io.env);
    const validated = parseSettings({ [key]: value }, 'command line');
    const path = await saveSettings({ ...patch, ...validated }, io.env);
    if (!boolOf(args, 'quiet')) io.write(`${key} set in ${path}.\n`);
    return ExitCode.Success;
  }

  if (action === 'unset') {
    if (key === undefined) throw usageError('unset needs a key.');
    if (!isSettingKey(key)) {
      throw usageError(`"${key}" is not a known setting.`);
    }
    const stored = await loadStoredPatch(io.env);
    const patch = Object.fromEntries(
      Object.entries(stored).filter(([name]) => name !== key),
    );
    const path = await saveSettings(patch, io.env);
    if (!boolOf(args, 'quiet')) io.write(`${key} removed from ${path}.\n`);
    return ExitCode.Success;
  }

  throw usageError(
    `"${action}" is not a config subcommand.`,
    'Use show, path, set or unset.',
  );
}

export async function run(io: Io): Promise<ExitCodeValue> {
  const [first, ...rest] = io.argv;
  const painter = createPainter(
    shouldUseColour({
      noColorFlag: io.argv.includes('--no-color'),
      env: io.env,
      isTty: io.stdoutIsTty,
    }),
  );

  try {
    if (first === undefined || first === '--help' || first === '-h') {
      io.write(rootHelp());
      return first === undefined ? ExitCode.Usage : ExitCode.Success;
    }
    if (first === '--version' || first === '-v') {
      io.write(`${versionLine()}\n`);
      return ExitCode.Success;
    }
    if (!isCommand(first)) {
      throw usageError(
        `"${first}" is not a requestlab command.`,
        `Commands: ${COMMANDS.join(', ')}.`,
      );
    }
    switch (first) {
      case 'send':
      case 'inspect':
        return await runRequestCommand(first, rest, io);
      case 'compare':
        return await runCompare(rest, io);
      case 'history':
        return await runHistory(rest, io);
      case 'config':
        return await runConfig(rest, io);
    }
  } catch (error) {
    if (isAppError(error)) {
      reportError(error, io, painter);
      return error.exitCode;
    }
    const message =
      error instanceof Error ? error.message : 'an unknown failure';
    io.writeError(
      `${painter('internal error', 'red')}: ${message}\n` +
        '  This is a defect. Please report it at ' +
        'https://github.com/sablectl/requestlab/issues\n',
    );
    return ExitCode.Internal;
  }
}
