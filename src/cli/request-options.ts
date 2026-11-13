// Options shared by every command that performs a request, and the
// construction of a request specification from them.

import { fileBody, jsonBody, stdinBody, textBody } from '../core/body.js';
import type { Settings } from '../core/config.js';
import { usageError } from '../core/errors.js';
import { parseRequestUrl } from '../core/transport.js';
import type { HeaderPair, PreparedBody, RequestSpec } from '../core/types.js';
import {
  boolOf,
  listOf,
  methodOf,
  numberOf,
  parseHeaderArgument,
  parseQueryArgument,
  stringOf,
  type OptionSpec,
  type ParsedArgs,
} from './args.js';

export const REQUEST_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  method: {
    kind: 'string',
    short: 'X',
    valueName: 'METHOD',
    describe: 'HTTP method (default GET, or POST when a body is given)',
  },
  header: {
    kind: 'list',
    short: 'H',
    valueName: 'NAME: VALUE',
    describe: 'Request header; repeatable',
  },
  query: {
    kind: 'list',
    valueName: 'NAME=VALUE',
    describe: 'Query parameter appended to the URL; repeatable',
  },
  data: {
    kind: 'string',
    short: 'd',
    valueName: 'TEXT',
    describe: 'Request body as text',
  },
  'json-body': {
    kind: 'string',
    valueName: 'JSON',
    describe: 'Request body as JSON; validated before sending',
  },
  'data-file': {
    kind: 'string',
    valueName: 'PATH',
    describe: 'Request body read from a local file',
  },
  'data-stdin': {
    kind: 'boolean',
    describe: 'Request body read from standard input',
  },
  'user-agent': {
    kind: 'string',
    short: 'A',
    valueName: 'STRING',
    describe: 'User-Agent header value',
  },
  'bearer-env': {
    kind: 'string',
    valueName: 'VARIABLE',
    describe: 'Send Authorization: Bearer from this environment variable',
  },
  'basic-env': {
    kind: 'string',
    valueName: 'VARIABLE',
    describe: 'Send Authorization: Basic from user:password in this variable',
  },
  timeout: {
    kind: 'string',
    valueName: 'MS',
    describe: 'Overall deadline in milliseconds',
  },
  'connect-timeout': {
    kind: 'string',
    valueName: 'MS',
    describe: 'Connection deadline in milliseconds',
  },
  'max-redirects': {
    kind: 'string',
    valueName: 'N',
    describe: 'Maximum redirects to follow',
  },
  'no-follow': {
    kind: 'boolean',
    describe: 'Do not follow redirects; report the first response',
  },
  'max-body-size': {
    kind: 'string',
    valueName: 'BYTES',
    describe: 'Stop reading the response body after this many bytes',
  },
  'restrict-destinations': {
    kind: 'boolean',
    describe: 'Refuse loopback, private, link-local and metadata destinations',
  },
};

export interface RequestInputs {
  readonly spec: RequestSpec;
  /** True when the user asked for an authentication header. */
  readonly usedCredentials: boolean;
}

function authorisationFromEnv(
  args: ParsedArgs,
  env: NodeJS.ProcessEnv,
): HeaderPair | null {
  const bearer = stringOf(args, 'bearer-env');
  const basic = stringOf(args, 'basic-env');
  if (bearer !== undefined && basic !== undefined) {
    throw usageError('Use either --bearer-env or --basic-env, not both.');
  }
  if (bearer !== undefined) {
    const value = env[bearer];
    if (value === undefined || value === '') {
      throw usageError(`Environment variable ${bearer} is not set.`);
    }
    return { name: 'Authorization', value: `Bearer ${value}` };
  }
  if (basic !== undefined) {
    const value = env[basic];
    if (value === undefined || value === '') {
      throw usageError(`Environment variable ${basic} is not set.`);
    }
    if (!value.includes(':')) {
      throw usageError(
        `Environment variable ${basic} must hold user:password.`,
      );
    }
    return {
      name: 'Authorization',
      value: `Basic ${Buffer.from(value, 'utf8').toString('base64')}`,
    };
  }
  return null;
}

async function bodyFrom(
  args: ParsedArgs,
  stdin: NodeJS.ReadableStream,
): Promise<PreparedBody | null> {
  const text = stringOf(args, 'data');
  const json = stringOf(args, 'json-body');
  const path = stringOf(args, 'data-file');
  const fromStdin = boolOf(args, 'data-stdin');
  const given = [text, json, path].filter((v) => v !== undefined).length;
  if (given + (fromStdin ? 1 : 0) > 1) {
    throw usageError(
      'Give at most one of --data, --json-body, --data-file and --data-stdin.',
    );
  }
  if (text !== undefined) return textBody(text);
  if (json !== undefined) return jsonBody(json);
  if (path !== undefined) return fileBody(path);
  if (fromStdin) return stdinBody(stdin);
  return null;
}

export interface BuildContext {
  readonly settings: Settings;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
}

/** Build a request specification from one URL and the parsed options. */
export async function buildRequest(
  rawUrl: string,
  args: ParsedArgs,
  context: BuildContext,
): Promise<RequestInputs> {
  const url = parseRequestUrl(rawUrl);
  for (const raw of listOf(args, 'query')) {
    const { name, value } = parseQueryArgument(raw);
    url.searchParams.append(name, value);
  }

  const body = await bodyFrom(args, context.stdin);
  const methodArgument = stringOf(args, 'method');
  const method =
    methodArgument === undefined
      ? body === null
        ? 'GET'
        : 'POST'
      : methodOf(methodArgument);

  if (body !== null && (method === 'GET' || method === 'HEAD')) {
    throw usageError(
      `A request body cannot be sent with ${method}.`,
      'Use --method POST, PUT or PATCH.',
    );
  }

  const headers: HeaderPair[] = [];
  const seen = new Set<string>();
  for (const raw of listOf(args, 'header')) {
    const header = parseHeaderArgument(raw);
    headers.push(header);
    seen.add(header.name.toLowerCase());
  }

  const authorisation = authorisationFromEnv(args, context.env);
  if (authorisation !== null && !seen.has('authorization')) {
    headers.push(authorisation);
    seen.add('authorization');
  }

  const userAgent = stringOf(args, 'user-agent') ?? context.settings.userAgent;
  if (!seen.has('user-agent')) {
    headers.push({ name: 'User-Agent', value: userAgent });
  }
  if (!seen.has('accept')) headers.push({ name: 'Accept', value: '*/*' });
  if (body !== null) {
    if (!seen.has('content-type') && body.contentType !== undefined) {
      headers.push({ name: 'Content-Type', value: body.contentType });
    }
    if (!seen.has('content-length')) {
      headers.push({
        name: 'Content-Length',
        value: String(body.bytes.byteLength),
      });
    }
  }

  const noFollow = boolOf(args, 'no-follow');
  const spec: RequestSpec = {
    url: url.toString(),
    method,
    headers,
    ...(body === null ? {} : { body }),
    timeoutMs: numberOf(args, 'timeout', context.settings.timeoutMs),
    connectTimeoutMs: numberOf(
      args,
      'connect-timeout',
      context.settings.connectTimeoutMs,
    ),
    maxRedirects: noFollow
      ? 0
      : numberOf(args, 'max-redirects', context.settings.maxRedirects),
    maxBodyBytes: numberOf(
      args,
      'max-body-size',
      context.settings.maxBodyBytes,
    ),
    policy: {
      allowPrivate: !(
        boolOf(args, 'restrict-destinations') ||
        context.settings.restrictDestinations
      ),
    },
  };

  return { spec, usedCredentials: authorisation !== null };
}
