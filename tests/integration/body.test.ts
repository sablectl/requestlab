// Request bodies from every supported source.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, runCli, startServer } from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;
let dataFile: string;

beforeAll(async () => {
  workspace = await createWorkspace('body');
  dataFile = join(workspace.dir, 'payload.txt');
  await writeFile(dataFile, 'from a file', 'utf8');
  server = await startServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end('ok');
  });
});

afterAll(async () => {
  await server.close();
  await workspace.cleanup();
});

describe('--data', () => {
  it('sends the text and switches the default method to POST', async () => {
    const before = server.requests.length;
    const result = await runCli(
      ['send', server.url('/d'), '--data', 'plain text', '--quiet'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    const recorded = server.requests[before];
    expect(recorded?.method).toBe('POST');
    expect(recorded?.body).toBe('plain text');
    expect(recorded?.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(recorded?.headers['content-length']).toBe('10');
  });

  it('keeps an explicit method', async () => {
    const before = server.requests.length;
    await runCli(
      [
        'send',
        server.url('/d'),
        '--method',
        'PUT',
        '--data',
        'replacement',
        '--quiet',
      ],
      { env: workspace.env },
    );
    expect(server.requests[before]?.method).toBe('PUT');
    expect(server.requests[before]?.body).toBe('replacement');
  });

  it('refuses a body on GET', async () => {
    const result = await runCli(
      ['send', server.url('/d'), '--method', 'GET', '--data', 'x'],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('cannot be sent with GET');
  });
});

describe('--json-body', () => {
  it('sends the document with a JSON content type', async () => {
    const before = server.requests.length;
    const result = await runCli(
      ['send', server.url('/j'), '--json-body', '{"a":1}', '--quiet'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    const recorded = server.requests[before];
    expect(recorded?.body).toBe('{"a":1}');
    expect(recorded?.headers['content-type']).toBe('application/json');
  });

  it('rejects invalid JSON with exit 2 and sends nothing', async () => {
    const before = server.requests.length;
    const result = await runCli(
      ['send', server.url('/j'), '--json-body', '{not json}'],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('not valid JSON');
    expect(server.requests.length).toBe(before);
  });
});

describe('--data-file', () => {
  it('sends the contents of the file', async () => {
    const before = server.requests.length;
    const result = await runCli(
      ['inspect', server.url('/f'), '--data-file', dataFile],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(server.requests[before]?.body).toBe('from a file');
    expect(result.stdout).toContain('11 B from file');
  });

  it('reports a missing file as a usage error', async () => {
    const result = await runCli(
      [
        'send',
        server.url('/f'),
        '--data-file',
        join(workspace.dir, 'absent.txt'),
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('cannot be read');
  });
});

describe('--data-stdin', () => {
  it('sends what was piped in', async () => {
    const before = server.requests.length;
    const result = await runCli(['inspect', server.url('/s'), '--data-stdin'], {
      env: workspace.env,
      stdin: 'piped payload',
    });
    expect(result.code).toBe(0);
    expect(server.requests[before]?.body).toBe('piped payload');
    expect(result.stdout).toContain('13 B from stdin');
  });
});

describe('conflicting body sources', () => {
  it('refuses more than one', async () => {
    const result = await runCli(
      ['send', server.url('/x'), '--data', 'a', '--json-body', '{}'],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('at most one of');
  });
});
