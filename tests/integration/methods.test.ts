// Methods, headers and query parameters as the server receives them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HTTP_METHODS } from '../../src/core/types.js';
import { createWorkspace, runCli, startServer } from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;

beforeAll(async () => {
  workspace = await createWorkspace('methods');
  server = await startServer((request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end(request.method === 'HEAD' ? undefined : 'hello');
  });
});

afterAll(async () => {
  await server.close();
  await workspace.cleanup();
});

describe('methods', () => {
  for (const method of HTTP_METHODS) {
    it(`sends ${method}`, async () => {
      const before = server.requests.length;
      const result = await runCli(
        ['send', server.url('/method'), '--method', method, '--quiet'],
        { env: workspace.env },
      );
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      const recorded = server.requests[before];
      expect(recorded?.method).toBe(method);
      expect(recorded?.url).toBe('/method');
    });
  }

  it('defaults to GET', async () => {
    const before = server.requests.length;
    const result = await runCli(['send', server.url('/plain')], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(server.requests[before]?.method).toBe('GET');
  });

  it('rejects an unsupported method with a usage error', async () => {
    const result = await runCli(['send', server.url('/'), '--method', 'BREW'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a supported method');
  });
});

describe('headers', () => {
  it('sends a custom header', async () => {
    const before = server.requests.length;
    await runCli(
      ['send', server.url('/h'), '--header', 'X-Custom: value', '--quiet'],
      { env: workspace.env },
    );
    expect(server.requests[before]?.headers['x-custom']).toBe('value');
  });

  it('sends a repeated header once per occurrence', async () => {
    const before = server.requests.length;
    await runCli(
      [
        'send',
        server.url('/h'),
        '--header',
        'X-Repeated: one',
        '--header',
        'X-Repeated: two',
        '--quiet',
      ],
      { env: workspace.env },
    );
    expect(server.requests[before]?.headers['x-repeated']).toBe('one, two');
  });

  it('sends the default User-Agent and Accept headers', async () => {
    const before = server.requests.length;
    await runCli(['send', server.url('/h'), '--quiet'], {
      env: workspace.env,
    });
    const recorded = server.requests[before];
    expect(recorded?.headers['user-agent']).toBe('requestlab/1.0.0');
    expect(recorded?.headers['accept']).toBe('*/*');
  });

  it('lets --user-agent override the default', async () => {
    const before = server.requests.length;
    await runCli(
      ['send', server.url('/h'), '--user-agent', 'probe/9', '--quiet'],
      { env: workspace.env },
    );
    expect(server.requests[before]?.headers['user-agent']).toBe('probe/9');
  });

  it('rejects a header argument without a colon', async () => {
    const result = await runCli(
      ['send', server.url('/h'), '--header', 'nonsense'],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a header');
  });
});

describe('query parameters', () => {
  it('appends --query to a URL without a query string', async () => {
    const before = server.requests.length;
    await runCli(
      [
        'send',
        server.url('/q'),
        '--query',
        'a=1',
        '--query',
        'b=two',
        '--quiet',
      ],
      { env: workspace.env },
    );
    expect(server.requests[before]?.url).toBe('/q?a=1&b=two');
  });

  it('appends --query to a URL that already has one', async () => {
    const before = server.requests.length;
    await runCli(
      ['send', server.url('/q?keep=yes'), '--query', 'extra=1', '--quiet'],
      { env: workspace.env },
    );
    expect(server.requests[before]?.url).toBe('/q?keep=yes&extra=1');
  });

  it('percent-encodes a query value', async () => {
    const before = server.requests.length;
    await runCli(
      ['send', server.url('/q'), '--query', 'text=a b&c', '--quiet'],
      { env: workspace.env },
    );
    expect(server.requests[before]?.url).toBe('/q?text=a+b%26c');
  });

  it('rejects a query argument without an equals sign', async () => {
    const result = await runCli(
      ['send', server.url('/q'), '--query', 'nonsense'],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a query parameter');
  });
});
