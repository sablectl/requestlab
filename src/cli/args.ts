// Argument parsing.
//
// Hand-written rather than taken from a dependency: the surface is small, the
// rules are strict, and an unknown flag must be an error rather than a
// silently ignored token.

import { usageError } from '../core/errors.js';
import { HTTP_METHODS, type HttpMethod } from '../core/types.js';

export type OptionKind = 'boolean' | 'string' | 'list';

export interface OptionSpec {
  readonly kind: OptionKind;
  readonly short?: string;
  readonly describe: string;
  readonly valueName?: string;
}

export interface ParsedArgs {
  readonly positional: readonly string[];
  readonly booleans: ReadonlyMap<string, boolean>;
  readonly strings: ReadonlyMap<string, string>;
  readonly lists: ReadonlyMap<string, readonly string[]>;
}

export function parseArgs(
  argv: readonly string[],
  specs: Readonly<Record<string, OptionSpec>>,
): ParsedArgs {
  const byShort = new Map<string, string>();
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.short !== undefined) byShort.set(spec.short, name);
  }

  const positional: string[] = [];
  const booleans = new Map<string, boolean>();
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();

  const take = (name: string, inline: string | null, rest: string[]): void => {
    const spec = specs[name];
    if (spec === undefined) {
      throw usageError(
        `Unknown option "--${name}".`,
        'Run requestlab --help for the list of options.',
      );
    }
    if (spec.kind === 'boolean') {
      if (inline !== null) {
        throw usageError(`Option "--${name}" does not take a value.`);
      }
      booleans.set(name, true);
      return;
    }
    const value = inline ?? rest.shift();
    if (value === undefined) {
      throw usageError(`Option "--${name}" needs a value.`);
    }
    if (spec.kind === 'list') {
      const existing = lists.get(name) ?? [];
      existing.push(value);
      lists.set(name, existing);
    } else {
      strings.set(name, value);
    }
  };

  const rest = [...argv];
  let onlyPositional = false;
  while (rest.length > 0) {
    const token = rest.shift();
    if (token === undefined) break;
    if (onlyPositional) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      onlyPositional = true;
      continue;
    }
    if (token.startsWith('--')) {
      // `--` on its own was handled above, so the body is never empty here.
      const body = token.slice(2);
      const equals = body.indexOf('=');
      if (equals === -1) take(body, null, rest);
      else take(body.slice(0, equals), body.slice(equals + 1), rest);
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      // Short flags do not bundle: -abc would be ambiguous once any of them
      // takes a value, and ambiguity in a debugging tool is not worth the
      // keystrokes it saves.
      const short = token.slice(1);
      const name = byShort.get(short);
      if (name === undefined) {
        throw usageError(
          `Unknown option "-${short}".`,
          'Run requestlab --help for the list of options.',
        );
      }
      take(name, null, rest);
      continue;
    }
    positional.push(token);
  }

  return { positional, booleans, strings, lists };
}

export function boolOf(args: ParsedArgs, name: string): boolean {
  return args.booleans.get(name) ?? false;
}

export function stringOf(args: ParsedArgs, name: string): string | undefined {
  return args.strings.get(name);
}

export function listOf(args: ParsedArgs, name: string): readonly string[] {
  return args.lists.get(name) ?? [];
}

export function numberOf(
  args: ParsedArgs,
  name: string,
  fallback: number,
): number {
  const raw = args.strings.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw usageError(
      `Option "--${name}" must be a non-negative whole number, not "${raw}".`,
    );
  }
  return value;
}

export function methodOf(raw: string): HttpMethod {
  const upper = raw.toUpperCase();
  const found = HTTP_METHODS.find((method) => method === upper);
  if (found === undefined) {
    throw usageError(
      `"${raw}" is not a supported method.`,
      `Supported methods: ${HTTP_METHODS.join(', ')}.`,
    );
  }
  return found;
}

/** Split a `Name: value` header argument. */
export function parseHeaderArgument(raw: string): {
  name: string;
  value: string;
} {
  const colon = raw.indexOf(':');
  if (colon <= 0) {
    throw usageError(
      `"${raw}" is not a header.`,
      'Write headers as --header "Name: value".',
    );
  }
  const name = raw.slice(0, colon).trim();
  const value = raw.slice(colon + 1).trim();
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
    throw usageError(`"${name}" is not a valid header name.`);
  }
  if (/[\r\n]/.test(value)) {
    throw usageError('Header values may not contain line breaks.');
  }
  return { name, value };
}

/** Split a `name=value` query argument. */
export function parseQueryArgument(raw: string): {
  name: string;
  value: string;
} {
  const equals = raw.indexOf('=');
  if (equals <= 0) {
    throw usageError(
      `"${raw}" is not a query parameter.`,
      'Write query parameters as --query name=value.',
    );
  }
  return { name: raw.slice(0, equals), value: raw.slice(equals + 1) };
}
