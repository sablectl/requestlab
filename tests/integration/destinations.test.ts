// --restrict-destinations, on a literal address and on a name that resolves
// to one.

import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, runCli, startServer } from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;

beforeAll(async () => {
  workspace = await createWorkspace('destinations');
  server = await startServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end('reached');
  });
});

afterAll(async () => {
  await server.close();
  await workspace.cleanup();
});

describe('--restrict-destinations', () => {
  it('refuses a literal loopback address with exit 1', async () => {
    const before = server.requests.length;
    const result = await runCli(
      ['send', server.url('/'), '--restrict-destinations'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('127.0.0.1 is a loopback address');
    expect(result.stderr).toContain('destination restrictions are in force');
    expect(server.requests.length).toBe(before);
  });

  it('refuses a name that resolves to loopback with exit 1', async () => {
    const before = server.requests.length;
    const result = await runCli(
      ['send', `http://localhost:${server.port}/`, '--restrict-destinations'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('localhost resolves to');
    expect(result.stderr).toContain('loopback address');
    expect(server.requests.length).toBe(before);
  });

  it('offers the way to allow the request again', async () => {
    const result = await runCli(
      ['send', server.url('/'), '--restrict-destinations'],
      { env: workspace.env },
    );
    expect(result.stderr).toContain('Remove --restrict-destinations');
  });

  it('allows the same request without the flag', async () => {
    const before = server.requests.length;
    const result = await runCli(['send', server.url('/')], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('reached');
    expect(server.requests.length).toBe(before + 1);
  });

  it('allows a name that resolves to loopback without the flag', async () => {
    const result = await runCli(['send', `http://localhost:${server.port}/`], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('reached');
  });
});

describe('restrictDestinations as a stored setting', () => {
  it('refuses the request when the configuration turns it on', async () => {
    await writeFile(
      workspace.configPath,
      `${JSON.stringify({ restrictDestinations: true })}\n`,
      'utf8',
    );
    try {
      const result = await runCli(['send', server.url('/')], {
        env: workspace.env,
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('is a loopback address');
    } finally {
      await writeFile(workspace.configPath, '{}\n', 'utf8');
    }
  });
});
