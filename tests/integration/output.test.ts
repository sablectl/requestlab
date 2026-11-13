// Report output: the JSON envelope, redaction and colour handling.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANSI,
  createWorkspace,
  parseReport,
  runCli,
  startServer,
} from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;

beforeAll(async () => {
  workspace = await createWorkspace('output');
  server = await startServer((request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.setHeader('Set-Cookie', 'session=server-side-secret');
    response.setHeader('X-Api-Key', 'server-side-key');
    response.end(
      request.url === '/token' ? 'the value is Bearer abcdefghijklmnop' : 'ok',
    );
  });
});

afterAll(async () => {
  await server.close();
  await workspace.cleanup();
});

interface Envelope {
  readonly schemaVersion: number;
  readonly tool: string;
  readonly version: string;
  readonly command: string;
  readonly generatedAt: string;
  readonly status: string;
  readonly result: unknown;
}

function envelopeOf(stdout: string): Envelope {
  return parseReport(stdout) as unknown as Envelope;
}

describe('the JSON envelope', () => {
  it('is valid JSON with the documented fields', async () => {
    const result = await runCli(['config', 'show', '--json'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    const report = envelopeOf(result.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toBe('requestlab');
    expect(report.version).toBe('1.0.0');
    expect(report.command).toBe('config');
    expect(report.status).toBe('ok');
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
  });

  it('names the history command in its own envelope', async () => {
    const result = await runCli(['history', 'list', '--json'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    const report = envelopeOf(result.stdout);
    expect(report.command).toBe('history');
    expect(report.schemaVersion).toBe(1);
  });

  it('is pretty-printed with two spaces', async () => {
    const result = await runCli(['config', 'show', '--json'], {
      env: workspace.env,
    });
    expect(result.stdout).toContain('\n  "schemaVersion": 1,');
  });

  it('describes the exchange for send', async () => {
    const result = await runCli(['send', server.url('/'), '--json'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    const report = envelopeOf(result.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toBe('requestlab');
    expect(report.version).toBe('1.0.0');
    expect(report.command).toBe('send');
    expect(report.status).toBe('ok');
    const sent = report.result as {
      request: { method: string; url: string; bodyBytes: number };
      response: { status: number; headers: Record<string, string[]> };
      body: { bytes: number; sha256: string; truncated: boolean };
      timing: { totalMs: number };
      redirects: unknown[];
    };
    expect(sent.request.method).toBe('GET');
    expect(sent.request.url).toBe(server.url('/'));
    expect(sent.request.bodyBytes).toBe(0);
    expect(sent.response.status).toBe(200);
    expect(sent.response.headers['content-type']).toEqual(['text/plain']);
    expect(sent.body.bytes).toBe(2);
    expect(sent.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.body.truncated).toBe(false);
    expect(typeof sent.timing.totalMs).toBe('number');
    expect(sent.redirects).toEqual([]);
  });

  it('describes the exchange for inspect', async () => {
    const result = await runCli(['inspect', server.url('/'), '--json'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    const report = envelopeOf(result.stdout);
    expect(report.command).toBe('inspect');
    expect(report.status).toBe('ok');
    const inspected = report.result as {
      response: { status: number };
      body: { bytes: number; preview: string | null };
    };
    expect(inspected.response.status).toBe(200);
    expect(inspected.body.bytes).toBe(2);
    // `inspect` asks for no preview, so none is carried in the report.
    expect(inspected.body.preview).toBeNull();
  });

  it('redacts credentials inside the JSON result', async () => {
    const result = await runCli(
      [
        'send',
        server.url('/?token=json-query-secret'),
        '--json',
        '--header',
        'Authorization: Bearer json-header-secret',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('json-header-secret');
    expect(result.stdout).not.toContain('json-query-secret');
    const sent = envelopeOf(result.stdout).result as {
      request: { url: string; headers: Record<string, string[]> };
      response: { headers: Record<string, string[]> };
    };
    expect(sent.request.headers['authorization']).toEqual(['[redacted]']);
    expect(sent.request.url).toContain('token=%5Bredacted%5D');
    expect(sent.response.headers['set-cookie']).toEqual(['[redacted]']);
    expect(sent.response.headers['x-api-key']).toEqual(['[redacted]']);
  });

  it('reports a comparison of two identical responses', async () => {
    const result = await runCli(
      ['compare', server.url('/'), server.url('/'), '--json'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    const report = envelopeOf(result.stdout);
    expect(report.command).toBe('compare');
    expect(report.status).toBe('ok');
    const comparison = report.result as {
      identical: boolean;
      differences: unknown[];
      left: { status: number; sha256: string };
      right: { status: number; sha256: string };
    };
    expect(comparison.identical).toBe(true);
    expect(comparison.differences).toEqual([]);
    expect(comparison.left.status).toBe(200);
    expect(comparison.right.sha256).toBe(comparison.left.sha256);
  });

  it('marks a differing comparison as different', async () => {
    const result = await runCli(
      ['compare', server.url('/'), server.url('/token'), '--json'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    const report = envelopeOf(result.stdout);
    expect(report.status).toBe('different');
    const comparison = report.result as {
      identical: boolean;
      differences: unknown[];
    };
    expect(comparison.identical).toBe(false);
    expect(comparison.differences.length).toBeGreaterThan(0);
  });

  it('accepts the report flag and the body flag together', async () => {
    const before = server.requests.length;
    const result = await runCli(
      ['send', server.url('/'), '--json', '--json-body', '{"a":1}'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(server.requests[before]?.body).toBe('{"a":1}');
    const sent = envelopeOf(result.stdout).result as {
      request: { method: string; bodyBytes: number; bodySource: string };
    };
    expect(sent.request.method).toBe('POST');
    expect(sent.request.bodyBytes).toBe(7);
    expect(sent.request.bodySource).toBe('json');
  });
});

describe('redaction in human output', () => {
  it('hides a request Authorization header', async () => {
    const result = await runCli(
      [
        'send',
        server.url('/'),
        '--header',
        'Authorization: Bearer human-output-token',
        '--show-request',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Authorization: [redacted]');
    expect(result.stdout).not.toContain('human-output-token');
  });

  it('hides sensitive response headers', async () => {
    const result = await runCli(['send', server.url('/'), '--show-headers'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Set-Cookie: [redacted]');
    expect(result.stdout).toContain('X-Api-Key: [redacted]');
    expect(result.stdout).not.toContain('server-side-secret');
    expect(result.stdout).not.toContain('server-side-key');
  });

  it('hides credential-shaped query parameters in the URL', async () => {
    const result = await runCli(
      [
        'send',
        server.url('/'),
        '--query',
        'token=query-string-secret',
        '--query',
        'page=2',
        '--show-request',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('token=%5Bredacted%5D');
    expect(result.stdout).toContain('page=2');
    expect(result.stdout).not.toContain('query-string-secret');
  });

  it('redacts a credential-shaped string in the body preview', async () => {
    const result = await runCli(['send', server.url('/token')], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Bearer [redacted]');
    expect(result.stdout).not.toContain('abcdefghijklmnop');
  });

  it('still sends the real value to the server', async () => {
    const before = server.requests.length;
    await runCli(
      [
        'send',
        server.url('/'),
        '--header',
        'Authorization: Bearer really-sent',
        '--quiet',
      ],
      { env: workspace.env },
    );
    expect(server.requests[before]?.headers['authorization']).toBe(
      'Bearer really-sent',
    );
  });
});

describe('credentials from the environment', () => {
  it('never prints a --bearer-env value', async () => {
    const secret = 'env-supplied-bearer-value';
    const before = server.requests.length;
    const result = await runCli(
      ['inspect', server.url('/'), '--bearer-env', 'RL_TOKEN'],
      { env: { ...workspace.env, RL_TOKEN: secret } },
    );
    expect(result.code).toBe(0);
    expect(server.requests[before]?.headers['authorization']).toBe(
      `Bearer ${secret}`,
    );
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
    expect(result.stdout).toContain('Authorization: [redacted]');
  });

  it('builds a Basic header from --basic-env without printing it', async () => {
    const before = server.requests.length;
    const result = await runCli(
      ['send', server.url('/'), '--basic-env', 'RL_LOGIN', '--show-request'],
      { env: { ...workspace.env, RL_LOGIN: 'ada:lovelace' } },
    );
    expect(result.code).toBe(0);
    expect(server.requests[before]?.headers['authorization']).toBe(
      `Basic ${Buffer.from('ada:lovelace', 'utf8').toString('base64')}`,
    );
    expect(result.stdout).not.toContain('lovelace');
  });

  it('reports an unset variable as a usage error', async () => {
    const result = await runCli(
      ['send', server.url('/'), '--bearer-env', 'RL_ABSENT'],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('RL_ABSENT is not set');
  });
});

describe('colour', () => {
  it('colours output on a terminal', async () => {
    const result = await runCli(['send', server.url('/')], {
      env: workspace.env,
      stdoutIsTty: true,
    });
    expect(result.stdout).toMatch(ANSI);
  });

  it('writes no escape sequences with --no-color', async () => {
    const result = await runCli(['send', server.url('/'), '--no-color'], {
      env: workspace.env,
      stdoutIsTty: true,
    });
    expect(result.stdout).not.toMatch(ANSI);
  });

  it('writes no escape sequences when NO_COLOR is set', async () => {
    const result = await runCli(['send', server.url('/')], {
      env: { ...workspace.env, NO_COLOR: '1' },
      stdoutIsTty: true,
    });
    expect(result.stdout).not.toMatch(ANSI);
  });

  it('writes no escape sequences when the output is not a terminal', async () => {
    const result = await runCli(['send', server.url('/')], {
      env: workspace.env,
    });
    expect(result.stdout).not.toMatch(ANSI);
  });

  it('keeps error output monochrome too', async () => {
    const result = await runCli(['send', 'not-a-url', '--no-color'], {
      env: workspace.env,
      stdoutIsTty: true,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).not.toMatch(ANSI);
  });
});
