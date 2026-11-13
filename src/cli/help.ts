// Help text.
//
// Generated from the same option tables the parser uses, so an option cannot
// exist without being documented, or be documented without existing.

import { VERSION } from '../version.js';
import type { OptionSpec } from './args.js';

export const GLOBAL_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  help: { kind: 'boolean', short: 'h', describe: 'Show help and exit' },
  version: {
    kind: 'boolean',
    short: 'v',
    describe: 'Show the release number and exit',
  },
  json: { kind: 'boolean', describe: 'Write a JSON report to stdout' },
  quiet: {
    kind: 'boolean',
    short: 'q',
    describe: 'Print only what was asked for; no summary',
  },
  'no-color': { kind: 'boolean', describe: 'Disable colour' },
};

function optionLines(specs: Readonly<Record<string, OptionSpec>>): string[] {
  const rows = Object.entries(specs).map(([name, spec]) => {
    const short = spec.short === undefined ? '    ' : `-${spec.short}, `;
    const value = spec.valueName === undefined ? '' : ` <${spec.valueName}>`;
    return [`  ${short}--${name}${value}`, spec.describe] as const;
  });
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `${left.padEnd(width + 2)}${right}`);
}

export function section(
  title: string,
  specs: Readonly<Record<string, OptionSpec>>,
): string {
  return [`${title}:`, ...optionLines(specs)].join('\n');
}

export const SEND_OUTPUT_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  'show-request': {
    kind: 'boolean',
    short: 'i',
    describe: 'Include the request line and headers',
  },
  'show-headers': {
    kind: 'boolean',
    short: 'I',
    describe: 'Include the response headers',
  },
  'no-body': { kind: 'boolean', describe: 'Do not print the response body' },
  preview: {
    kind: 'string',
    valueName: 'CHARS',
    describe: 'Characters of body to print (default 2048; 0 for none)',
  },
  fail: {
    kind: 'boolean',
    describe: 'Exit 1 when the final status is 400 or above',
  },
  'save-history': {
    kind: 'boolean',
    describe: 'Record this request in the local history',
  },
};

export const COMPARE_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  'ignore-header': {
    kind: 'list',
    valueName: 'NAME',
    describe: 'Ignore this header; repeatable',
  },
  'only-header': {
    kind: 'list',
    valueName: 'NAME',
    describe: 'Compare only these headers; repeatable',
  },
  'no-ignore-volatile': {
    kind: 'boolean',
    describe: 'Compare volatile headers such as Date and Set-Cookie too',
  },
  'no-body-compare': {
    kind: 'boolean',
    describe: 'Do not compare response size and digest',
  },
};

const USAGE = `requestlab — HTTP inspection and debugging toolkit

Usage:
  requestlab <command> [options]

Commands:
  send <url>              Perform a request and report the response
  inspect <url>           Perform a request and report everything measured
  compare <url> <url>     Perform two requests and report the differences
  history [list|clear|path]
                          Inspect the local request history
  config [show|path|set|unset]
                          Inspect and change stored settings

Run "requestlab <command> --help" for the options of one command.`;

export function rootHelp(): string {
  return [USAGE, '', section('Global options', GLOBAL_OPTIONS), ''].join('\n');
}

export function versionLine(): string {
  return `requestlab ${VERSION}`;
}

const SECURITY_NOTE = [
  'Secrets given as command-line arguments are visible to other processes',
  'and are kept in shell history. Prefer --bearer-env or --basic-env, which',
  'read the value from an environment variable.',
].join('\n  ');

export function commandHelp(
  name: string,
  synopsis: string,
  description: string,
  specs: readonly (readonly [string, Readonly<Record<string, OptionSpec>>])[],
  note?: string,
): string {
  const parts = [
    `requestlab ${name} — ${description}`,
    '',
    'Usage:',
    `  ${synopsis}`,
    '',
  ];
  for (const [title, options] of specs) {
    parts.push(section(title, options), '');
  }
  if (note !== undefined) parts.push(`Note:\n  ${note}`, '');
  return parts.join('\n');
}

export { SECURITY_NOTE };
