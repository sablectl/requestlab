// Shared fixtures for the integration suite.
//
// Every test drives the real `run` function against a real HTTP server bound
// to the loopback interface on an ephemeral port. Nothing here contacts a
// network outside this machine, and each test file owns a temporary
// configuration and state directory so that no real user data is touched.

import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Io } from '../../../src/cli/run.js';
import type { ExitCodeValue } from '../../../src/core/errors.js';
import { run } from '../../../src/cli/run.js';

const execFileAsync = promisify(execFile);

/** A request as the server saw it, including the body it received. */
export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: NodeJS.Dict<string | string[]>;
  readonly rawHeaders: readonly string[];
  readonly body: string;
}

export type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: string,
) => void;

export interface TestServer {
  readonly origin: string;
  readonly port: number;
  /** The requests this server has answered, in order. */
  readonly requests: readonly RecordedRequest[];
  url(path?: string): string;
  close(): Promise<void>;
}

/**
 * Start a server on the given loopback host and an ephemeral port.
 *
 * The body is buffered before the handler runs so that a test can assert on
 * what was actually transmitted.
 */
export async function startServer(
  handler: Handler,
  host = '127.0.0.1',
): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        rawHeaders: [...request.rawHeaders],
        body,
      });
      handler(request, response, body);
    });
  });
  // Keep-alive sockets would otherwise hold the process open past the test.
  server.keepAliveTimeout = 1;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server did not report a port');
  }
  const bracketed = address.address.includes(':')
    ? `[${address.address}]`
    : address.address;
  const origin = `http://${bracketed}:${address.port}`;

  return {
    origin,
    port: address.port,
    requests,
    url: (path = '/') => `${origin}${path}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** True when a server can be bound to the IPv6 loopback address. */
export async function ipv6Available(): Promise<boolean> {
  try {
    const server = await startServer((_request, response) => {
      response.end();
    }, '::1');
    await server.close();
    return true;
  } catch {
    return false;
  }
}

export interface Workspace {
  readonly dir: string;
  readonly configPath: string;
  readonly stateDir: string;
  readonly historyPath: string;
  readonly env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

/** A private configuration and state directory for one test file. */
export async function createWorkspace(name: string): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), `requestlab-${name}-`));
  const configPath = join(dir, 'config.json');
  const stateDir = join(dir, 'state');
  return {
    dir,
    configPath,
    stateDir,
    historyPath: join(stateDir, 'history.jsonl'),
    env: {
      REQUESTLAB_CONFIG: configPath,
      REQUESTLAB_STATE_DIR: stateDir,
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export interface IoOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: string;
  readonly stdoutIsTty?: boolean;
  readonly signal?: AbortSignal;
}

export interface RunResult {
  readonly code: ExitCodeValue;
  readonly stdout: string;
  readonly stderr: string;
}

/** Drive `run` in process with a collecting Io and return everything it did. */
export async function runCli(
  argv: readonly string[],
  options: IoOptions = {},
): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  const io: Io = {
    argv,
    env: options.env ?? {},
    stdin: Readable.from([Buffer.from(options.stdin ?? '', 'utf8')]),
    stdoutIsTty: options.stdoutIsTty ?? false,
    write: (text) => {
      stdout += text;
    },
    writeError: (text) => {
      stderr += text;
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const code = await run(io);
  return { code, stdout, stderr };
}

/** Parse the JSON report a command wrote to stdout. */
export function parseReport(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

export const BINARY = fileURLToPath(
  new URL('../../../dist/bin/requestlab.js', import.meta.url),
);

export interface SpawnResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the compiled binary as a child process. */
export async function runBinary(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<SpawnResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [BINARY, ...argv],
      { env: { PATH: process.env['PATH'] ?? '', ...env }, encoding: 'utf8' },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** Wait for the given number of milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// eslint-disable-next-line no-control-regex
export const ANSI = /\u001B\[[0-9;]*m/;
