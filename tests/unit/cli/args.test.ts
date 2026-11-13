// Argument parsing.

import { describe, expect, it } from 'vitest';
import {
  boolOf,
  listOf,
  methodOf,
  numberOf,
  parseArgs,
  parseHeaderArgument,
  parseQueryArgument,
  stringOf,
  type OptionSpec,
} from '../../../src/cli/args.js';
import { AppError } from '../../../src/core/errors.js';

const SPECS: Readonly<Record<string, OptionSpec>> = {
  json: { kind: 'boolean', short: 'j', describe: 'JSON output' },
  method: { kind: 'string', short: 'X', describe: 'Method' },
  header: { kind: 'list', short: 'H', describe: 'Header' },
  timeout: { kind: 'string', describe: 'Timeout' },
};

describe('parseArgs', () => {
  it('reads long options and positional arguments', () => {
    const args = parseArgs(
      ['send', 'https://example.com/', '--json', '--method', 'POST'],
      SPECS,
    );
    expect(args.positional).toEqual(['send', 'https://example.com/']);
    expect(boolOf(args, 'json')).toBe(true);
    expect(stringOf(args, 'method')).toBe('POST');
  });

  it('reads short options', () => {
    const args = parseArgs(['-j', '-X', 'PUT'], SPECS);
    expect(boolOf(args, 'json')).toBe(true);
    expect(stringOf(args, 'method')).toBe('PUT');
  });

  it('reads the --name=value form', () => {
    const args = parseArgs(['--method=DELETE'], SPECS);
    expect(stringOf(args, 'method')).toBe('DELETE');
  });

  it('accepts an empty value in the --name=value form', () => {
    const args = parseArgs(['--method='], SPECS);
    expect(stringOf(args, 'method')).toBe('');
  });

  it('collects a repeated list option in order', () => {
    const args = parseArgs(
      ['--header', 'A: 1', '-H', 'B: 2', '--header=C: 3'],
      SPECS,
    );
    expect(listOf(args, 'header')).toEqual(['A: 1', 'B: 2', 'C: 3']);
  });

  it('keeps the last value of a repeated string option', () => {
    const args = parseArgs(['-X', 'GET', '-X', 'POST'], SPECS);
    expect(stringOf(args, 'method')).toBe('POST');
  });

  it('defaults absent options', () => {
    const args = parseArgs([], SPECS);
    expect(boolOf(args, 'json')).toBe(false);
    expect(stringOf(args, 'method')).toBeUndefined();
    expect(listOf(args, 'header')).toEqual([]);
  });

  it('refuses an unknown long option', () => {
    let caught: unknown;
    try {
      parseArgs(['--nope'], SPECS);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('usage');
    expect((caught as AppError).message).toBe('Unknown option "--nope".');
    expect((caught as AppError).hint).toBe(
      'Run requestlab --help for the list of options.',
    );
  });

  it('refuses an unknown short option', () => {
    expect(() => parseArgs(['-q'], SPECS)).toThrow('Unknown option "-q".');
  });

  it('refuses a missing value', () => {
    expect(() => parseArgs(['--method'], SPECS)).toThrow(
      'Option "--method" needs a value.',
    );
    expect(() => parseArgs(['-X'], SPECS)).toThrow(
      'Option "--method" needs a value.',
    );
  });

  it('refuses a value given to a boolean option', () => {
    expect(() => parseArgs(['--json=true'], SPECS)).toThrow(
      'Option "--json" does not take a value.',
    );
  });

  it('stops parsing options after --', () => {
    const args = parseArgs(['--json', '--', '--method', '-q'], SPECS);
    expect(boolOf(args, 'json')).toBe(true);
    expect(args.positional).toEqual(['--method', '-q']);
  });

  it('treats a lone dash as a positional argument', () => {
    expect(parseArgs(['-'], SPECS).positional).toEqual(['-']);
  });
});

describe('numberOf', () => {
  it('returns the fallback when the option is absent', () => {
    expect(numberOf(parseArgs([], SPECS), 'timeout', 42)).toBe(42);
  });

  it('reads a non-negative whole number', () => {
    const args = parseArgs(['--timeout', '0'], SPECS);
    expect(numberOf(args, 'timeout', 42)).toBe(0);
  });

  it('refuses a negative, fractional or non-numeric value', () => {
    for (const raw of ['-1', '1.5', 'soon']) {
      const args = parseArgs([`--timeout=${raw}`], SPECS);
      expect(() => numberOf(args, 'timeout', 42)).toThrow(
        `Option "--timeout" must be a non-negative whole number, not "${raw}".`,
      );
    }
  });
});

describe('methodOf', () => {
  it('accepts a method in any case', () => {
    expect(methodOf('get')).toBe('GET');
    expect(methodOf('Patch')).toBe('PATCH');
  });

  it('refuses an unknown method', () => {
    let caught: unknown;
    try {
      methodOf('FETCH');
    } catch (error) {
      caught = error;
    }
    expect((caught as AppError).message).toBe(
      '"FETCH" is not a supported method.',
    );
    expect((caught as AppError).hint).toContain('Supported methods:');
  });
});

describe('parseHeaderArgument', () => {
  it('splits a header and trims both halves', () => {
    expect(parseHeaderArgument('Accept:  application/json ')).toEqual({
      name: 'Accept',
      value: 'application/json',
    });
  });

  it('keeps a colon inside the value', () => {
    expect(parseHeaderArgument('X-Url: https://example.com/')).toEqual({
      name: 'X-Url',
      value: 'https://example.com/',
    });
  });

  it('allows an empty value', () => {
    expect(parseHeaderArgument('X-Empty:')).toEqual({
      name: 'X-Empty',
      value: '',
    });
  });

  it('refuses an argument without a colon', () => {
    expect(() => parseHeaderArgument('Accept')).toThrow(
      '"Accept" is not a header.',
    );
  });

  it('refuses an argument that begins with a colon', () => {
    expect(() => parseHeaderArgument(':value')).toThrow(
      '":value" is not a header.',
    );
  });

  it('refuses invalid characters in the name', () => {
    expect(() => parseHeaderArgument('Bad Name: value')).toThrow(
      '"Bad Name" is not a valid header name.',
    );
  });

  it('refuses a line break in the value', () => {
    expect(() => parseHeaderArgument('X-Bad: a\r\nX-Other: b')).toThrow(
      'Header values may not contain line breaks.',
    );
  });
});

describe('parseQueryArgument', () => {
  it('splits at the first equals sign', () => {
    expect(parseQueryArgument('q=a=b')).toEqual({ name: 'q', value: 'a=b' });
  });

  it('allows an empty value', () => {
    expect(parseQueryArgument('q=')).toEqual({ name: 'q', value: '' });
  });

  it('refuses an argument without a name', () => {
    expect(() => parseQueryArgument('=value')).toThrow(
      '"=value" is not a query parameter.',
    );
    expect(() => parseQueryArgument('q')).toThrow(
      '"q" is not a query parameter.',
    );
  });
});
