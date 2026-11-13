// Interruption: an AbortSignal handed to `run` must end the exchange and
// produce the interrupted exit code.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  delay,
  runCli,
  startServer,
} from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;

beforeAll(async () => {
  workspace = await createWorkspace('cancellation');
  server = await startServer((request, response) => {
    if (request.url === '/slow-headers') {
      const timer = setTimeout(() => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/plain');
        response.end('too late');
      }, 5000);
      timer.unref();
      return;
    }
    if (request.url === '/slow-body') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/plain');
      response.write('start');
      const timer = setTimeout(() => {
        response.end('rest');
      }, 5000);
      timer.unref();
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

describe('aborting a request in flight', () => {
  it('exits 130 while waiting for the response headers', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = runCli(['send', server.url('/slow-headers')], {
      env: workspace.env,
      signal: controller.signal,
    });
    await delay(100);
    controller.abort();
    const result = await pending;
    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Interrupted.');
    expect(result.stdout).toBe('');
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('exits 130 while the body is still arriving', async () => {
    const controller = new AbortController();
    const pending = runCli(['send', server.url('/slow-body')], {
      env: workspace.env,
      signal: controller.signal,
    });
    await delay(150);
    controller.abort();
    const result = await pending;
    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Interrupted.');
  });

  it('exits 130 for a signal that was aborted before the command started', async () => {
    const before = server.requests.length;
    const result = await runCli(['send', server.url('/'), '--quiet'], {
      env: workspace.env,
      signal: AbortSignal.abort(),
    });
    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Interrupted.');
    expect(result.stdout).toBe('');
    expect(server.requests.length).toBe(before);
  });

  it('interrupts a comparison too', async () => {
    const controller = new AbortController();
    const pending = runCli(
      ['compare', server.url('/slow-headers'), server.url('/')],
      { env: workspace.env, signal: controller.signal },
    );
    await delay(100);
    controller.abort();
    const result = await pending;
    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Interrupted.');
  });

  it('leaves an untouched signal alone', async () => {
    const controller = new AbortController();
    const result = await runCli(['send', server.url('/'), '--quiet'], {
      env: workspace.env,
      signal: controller.signal,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ok');
  });
});
