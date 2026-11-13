// A request to a server bound to the IPv6 loopback address.
//
// A machine without IPv6 cannot run these, so the suite is skipped rather
// than failed when nothing can be bound to ::1.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  ipv6Available,
  runCli,
  startServer,
} from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

const IPV6 = await ipv6Available();

let server: TestServer;
let workspace: Workspace;

beforeAll(async () => {
  workspace = await createWorkspace('ipv6');
  if (!IPV6) return;
  server = await startServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end('over IPv6');
  }, '::1');
});

afterAll(async () => {
  if (IPV6) await server.close();
  await workspace.cleanup();
});

describe.skipIf(!IPV6)('IPv6 (skipped where ::1 cannot be bound)', () => {
  it('performs a request in the http://[::1]:PORT/ form', async () => {
    const before = server.requests.length;
    expect(server.origin).toContain('[::1]:');
    const result = await runCli(['send', server.url('/v6'), '--quiet'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('over IPv6');
    expect(server.requests.length).toBe(before + 1);
    expect(server.requests[before]?.url).toBe('/v6');
  });

  it('reports the IPv6 peer for inspect', async () => {
    const result = await runCli(['inspect', server.url('/v6')], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('::1');
    expect(result.stdout).not.toContain('could not be resolved');
  });

  it('classifies the literal before any lookup is attempted', async () => {
    // The destination check reads the bracketed host correctly, so
    // --restrict-destinations refuses ::1 as loopback.
    const result = await runCli(
      ['send', server.url('/v6'), '--restrict-destinations'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('loopback address');
    expect(result.stderr).not.toContain('could not be resolved');
  });
});
