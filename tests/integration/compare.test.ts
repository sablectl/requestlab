// The compare command.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, runCli, startServer } from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;

/** Counts calls per path so that a path can answer differently each time. */
const calls = new Map<string, number>();

function nextCall(path: string): number {
  const count = (calls.get(path) ?? 0) + 1;
  calls.set(path, count);
  return count;
}

beforeAll(async () => {
  workspace = await createWorkspace('compare');
  server = await startServer((request, response) => {
    const path = request.url ?? '/';
    response.setHeader('Content-Type', 'text/plain');
    if (path === '/varying-header') {
      const count = nextCall(path);
      response.setHeader('X-Stable', 'constant');
      response.setHeader('X-Variant', count % 2 === 1 ? 'one' : 'two');
      response.statusCode = 200;
      response.end('identical body');
      return;
    }
    if (path === '/varying-body') {
      const count = nextCall(path);
      response.statusCode = 200;
      response.end(count % 2 === 1 ? 'first' : 'second body');
      return;
    }
    if (path === '/varying-digest') {
      // Equal lengths, so only the digest differs: Content-Length is a
      // header like any other and is compared on its own.
      const count = nextCall(path);
      response.statusCode = 200;
      response.end(count % 2 === 1 ? 'alpha!' : 'omega?');
      return;
    }
    if (path === '/varying-status') {
      const count = nextCall(path);
      response.statusCode = count % 2 === 1 ? 200 : 404;
      response.end('body');
      return;
    }
    response.statusCode = 200;
    response.end('stable body');
  });
});

afterAll(async () => {
  await server.close();
  await workspace.cleanup();
});

describe('identical responses', () => {
  it('exits 0 and says so', async () => {
    const result = await runCli(
      ['compare', server.url('/stable'), server.url('/stable')],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('IDENTICAL');
    expect(result.stdout).toContain('No differences outside the ignored');
  });

  it('reports timing without counting it as a difference', async () => {
    const result = await runCli(
      ['compare', server.url('/stable'), server.url('/stable')],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Timing');
    expect(result.stdout).toContain('Difference');
  });

  it('prints nothing with --quiet', async () => {
    const result = await runCli(
      ['compare', server.url('/stable'), server.url('/stable'), '--quiet'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('differing responses', () => {
  it('exits 1 when the body differs', async () => {
    const result = await runCli(
      ['compare', server.url('/varying-body'), server.url('/varying-body')],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('body size');
    expect(result.stdout).toContain('body sha256');
  });

  it('exits 1 when the status differs', async () => {
    const result = await runCli(
      ['compare', server.url('/varying-status'), server.url('/varying-status')],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('status');
  });

  it('exits 1 when only the digest differs', async () => {
    const result = await runCli(
      ['compare', server.url('/varying-digest'), server.url('/varying-digest')],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('body sha256');
    expect(result.stdout).not.toContain('body size');
  });

  it('ignores the body with --no-body-compare', async () => {
    const result = await runCli(
      [
        'compare',
        server.url('/varying-digest'),
        server.url('/varying-digest'),
        '--no-body-compare',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('IDENTICAL');
  });
});

describe('--ignore-header', () => {
  it('reports the header difference when nothing is ignored', async () => {
    const result = await runCli(
      ['compare', server.url('/varying-header'), server.url('/varying-header')],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('x-variant');
  });

  it('suppresses that difference when the header is ignored', async () => {
    const result = await runCli(
      [
        'compare',
        server.url('/varying-header'),
        server.url('/varying-header'),
        '--ignore-header',
        'X-Variant',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('IDENTICAL');
    expect(result.stdout).toContain('Ignored headers:');
    expect(result.stdout).toContain('x-variant');
  });
});

describe('--only-header', () => {
  it('limits the comparison to the named header', async () => {
    const result = await runCli(
      [
        'compare',
        server.url('/varying-header'),
        server.url('/varying-header'),
        '--only-header',
        'X-Stable',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('IDENTICAL');
  });

  it('still reports a difference in a header that was named', async () => {
    const result = await runCli(
      [
        'compare',
        server.url('/varying-header'),
        server.url('/varying-header'),
        '--only-header',
        'X-Variant',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('x-variant');
  });
});

describe('compare usage', () => {
  it('needs exactly two URLs', async () => {
    const result = await runCli(['compare', server.url('/stable')], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('compare needs exactly two URLs');
  });
});
