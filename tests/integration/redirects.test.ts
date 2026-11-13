// Redirect following, the recorded chain, and the limits around it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, runCli, startServer } from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let origin: TestServer;
let other: TestServer;
let workspace: Workspace;

beforeAll(async () => {
  workspace = await createWorkspace('redirects');
  other = await startServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end('other origin');
  });
  origin = await startServer((request, response) => {
    const path = request.url ?? '/';
    const redirect = (location: string, status = 302): void => {
      response.statusCode = status;
      response.setHeader('Location', location);
      response.end('redirecting');
    };
    switch (path) {
      case '/start':
        redirect('/second');
        return;
      case '/second':
        redirect('/final');
        return;
      case '/loop':
        redirect('/loop');
        return;
      case '/bad-url':
        redirect('http://[');
        return;
      case '/bad-scheme':
        redirect('ftp://files.invalid/thing');
        return;
      case '/cross':
        redirect(other.url('/landing'));
        return;
      case '/see-other':
        redirect('/final', 303);
        return;
      default:
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/plain');
        response.end('arrived');
    }
  });
});

afterAll(async () => {
  await origin.close();
  await other.close();
  await workspace.cleanup();
});

describe('following redirects', () => {
  it('reaches the final destination and reports the chain', async () => {
    const result = await runCli(['send', origin.url('/start')], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('arrived');
    expect(result.stdout).toContain('Redirects');
    expect(result.stdout).toContain(`${origin.origin}/start`);
    expect(result.stdout).toContain(`Final URL`);
    expect(result.stdout).toContain(`${origin.origin}/final`);
  });

  it('numbers every hop in the inspect report', async () => {
    const result = await runCli(['inspect', origin.url('/start')], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Redirect chain');
    expect(result.stdout).toContain('1. 302 GET');
    expect(result.stdout).toContain('2. 302 GET');
    expect(result.stdout).toContain(`Final URL       ${origin.origin}/final`);
  });

  it('rewrites a POST to GET and drops the body on 303', async () => {
    const before = origin.requests.length;
    const result = await runCli(
      ['send', origin.url('/see-other'), '--data', 'payload'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(origin.requests[before]?.method).toBe('POST');
    expect(origin.requests[before + 1]?.method).toBe('GET');
    expect(origin.requests[before + 1]?.body).toBe('');
    expect(origin.requests[before + 1]?.headers['content-type']).toBe(
      undefined,
    );
  });
});

describe('--no-follow', () => {
  it('reports the first response and goes no further', async () => {
    const before = origin.requests.length;
    const result = await runCli(['send', origin.url('/start'), '--no-follow'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('302');
    expect(result.stdout).not.toContain('Redirects');
    expect(origin.requests.length).toBe(before + 1);
  });
});

describe('redirect limits and malformed targets', () => {
  it('stops once --max-redirects is exceeded', async () => {
    const result = await runCli(
      ['send', origin.url('/loop'), '--max-redirects', '2'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('More than 2 redirects were followed.');
  });

  it('refuses a Location that is not a valid URL', async () => {
    const result = await runCli(['send', origin.url('/bad-url')], {
      env: workspace.env,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not a valid URL');
  });

  it('refuses a redirect to a scheme that is not http or https', async () => {
    const result = await runCli(['send', origin.url('/bad-scheme')], {
      env: workspace.env,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unsupported scheme');
  });
});

describe('credentials across a redirect', () => {
  it('keeps Authorization on a same-origin redirect', async () => {
    const before = origin.requests.length;
    const result = await runCli(
      [
        'send',
        origin.url('/start'),
        '--header',
        'Authorization: Bearer same-origin-token',
        '--quiet',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(origin.requests[before + 2]?.headers['authorization']).toBe(
      'Bearer same-origin-token',
    );
  });

  it('does not forward Authorization to another origin', async () => {
    const before = other.requests.length;
    const result = await runCli(
      [
        'send',
        origin.url('/cross'),
        '--header',
        'Authorization: Bearer cross-origin-token',
        '--header',
        'Cookie: session=secret',
        '--quiet',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    const landed = other.requests[before];
    expect(landed?.url).toBe('/landing');
    expect(landed?.headers['authorization']).toBeUndefined();
    expect(landed?.headers['cookie']).toBeUndefined();
    expect(result.stdout).not.toContain('cross-origin-token');
  });
});
