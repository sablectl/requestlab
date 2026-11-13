// Failure modes and the exit code each one produces.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, runCli, startServer } from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;
/** A port nothing is listening on: a server was bound to it, then closed. */
let closedPort: number;

beforeAll(async () => {
  workspace = await createWorkspace('errors');
  const vacated = await startServer((_request, response) => {
    response.end();
  });
  closedPort = vacated.port;
  await vacated.close();

  server = await startServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/slow') {
      const timer = setTimeout(() => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/plain');
        response.end('late');
      }, 2000);
      timer.unref();
      return;
    }
    if (path === '/large') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/plain');
      response.end('x'.repeat(100_000));
      return;
    }
    if (path === '/missing') {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain');
      response.end('not here');
      return;
    }
    if (path === '/broken') {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'text/plain');
      response.end('server fault');
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end('ok');
  });
});

afterAll(async () => {
  await server.close();
  await workspace.cleanup();
});

describe('usage errors exit 2', () => {
  it('rejects an unknown command', async () => {
    const result = await runCli(['bogus'], { env: workspace.env });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a requestlab command');
  });

  it('rejects an unknown long option', async () => {
    const result = await runCli(['send', server.url('/'), '--nope'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown option "--nope"');
  });

  it('rejects an unknown short option', async () => {
    const result = await runCli(['send', server.url('/'), '-Z'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown option "-Z"');
  });

  it('rejects a URL that is not absolute', async () => {
    const result = await runCli(['send', 'not-a-url'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a valid absolute URL');
  });

  it('rejects a scheme that is not http or https', async () => {
    const result = await runCli(['send', 'ftp://127.0.0.1/file'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not supported');
  });

  it('rejects send without a URL', async () => {
    const result = await runCli(['send'], { env: workspace.env });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('send needs a URL');
  });

  it('rejects a non-numeric option value', async () => {
    const result = await runCli(
      ['send', server.url('/'), '--timeout', 'soon'],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('must be a non-negative whole number');
  });

  it('exits 2 when no command is given, after printing the help', async () => {
    const result = await runCli([], { env: workspace.env });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('requestlab <command> [options]');
  });
});

describe('help and version exit 0', () => {
  it('prints the root help', async () => {
    const result = await runCli(['--help'], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Commands:');
  });

  it('prints the release number', async () => {
    const result = await runCli(['--version'], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('requestlab 1.0.0');
  });
});

describe('transport failures exit 1', () => {
  it('reports a refused connection', async () => {
    const result = await runCli(['send', `http://127.0.0.1:${closedPort}/`], {
      env: workspace.env,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('The connection failed');
    expect(result.stderr).toContain('ECONNREFUSED');
  });

  it('gives up on a slow endpoint once --timeout passes', async () => {
    const started = Date.now();
    const result = await runCli(
      ['send', server.url('/slow'), '--timeout', '300'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('did not complete within 300 ms');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('gives up when nothing accepts within --connect-timeout', async () => {
    // 192.0.2.0/24 is reserved for documentation (RFC 5737): no host answers
    // and no third party is contacted. A network that answers immediately
    // with "unreachable" produces a connection failure instead, which is the
    // same class of outcome.
    const started = Date.now();
    const result = await runCli(
      [
        'send',
        'http://192.0.2.1:8080/',
        '--connect-timeout',
        '400',
        '--timeout',
        '20000',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /No connection within 400 ms\.|The connection failed/,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('keeps a quick request well inside a short connect deadline', async () => {
    const result = await runCli(
      ['send', server.url('/'), '--connect-timeout', '5000', '--quiet'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ok');
  });
});

describe('--max-body-size', () => {
  it('stops reading and says the body was truncated', async () => {
    const result = await runCli(
      ['send', server.url('/large'), '--max-body-size', '128', '--no-body'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('128 B (truncated at the size limit)');
  });

  it('reads the whole body when the limit is generous', async () => {
    const result = await runCli(['send', server.url('/large'), '--no-body'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('97.7 KiB');
    expect(result.stdout).not.toContain('truncated at the size limit');
  });
});

describe('--fail', () => {
  it('returns 1 on a 4xx', async () => {
    const result = await runCli(
      ['send', server.url('/missing'), '--fail', '--quiet'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
  });

  it('returns 1 on a 5xx', async () => {
    const result = await runCli(
      ['send', server.url('/broken'), '--fail', '--quiet'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
  });

  it('returns 0 on a 4xx without the flag', async () => {
    const result = await runCli(['send', server.url('/missing')], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('404');
  });
});
