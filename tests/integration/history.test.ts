// The local request history: what is written, what is never written, and the
// commands that read it.

import { readFile, rm, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../../src/core/history.js';
import {
  createWorkspace,
  parseReport,
  runCli,
  startServer,
} from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;
let closedPort: number;

const BODY = 'a response body that must never be recorded';

async function readEntries(path: string): Promise<HistoryEntry[]> {
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as HistoryEntry);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  workspace = await createWorkspace('history');
  const vacated = await startServer((_request, response) => {
    response.end();
  });
  closedPort = vacated.port;
  await vacated.close();

  server = await startServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end(BODY);
  });
});

beforeEach(async () => {
  await rm(workspace.stateDir, { recursive: true, force: true });
  await writeFile(workspace.configPath, '{}\n', 'utf8');
});

afterAll(async () => {
  await server.close();
  await workspace.cleanup();
});

describe('history is off by default', () => {
  it('writes nothing for an ordinary request', async () => {
    const result = await runCli(['send', server.url('/'), '--quiet'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(await fileExists(workspace.historyPath)).toBe(false);
  });

  it('reports an empty history', async () => {
    const result = await runCli(['history', 'list'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No history recorded.');
  });
});

describe('--save-history', () => {
  it('writes one redacted entry with no body content', async () => {
    const result = await runCli(
      [
        'send',
        server.url('/resource?token=secret-value'),
        '--save-history',
        '--header',
        'Authorization: Bearer history-token',
        '--quiet',
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);

    const entries = await readEntries(workspace.historyPath);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.method).toBe('GET');
    expect(entry.status).toBe(200);
    expect(entry.statusText).toBe('OK');
    expect(entry.redirects).toBe(0);
    expect(entry.error).toBeNull();
    expect(entry.responseBodyBytes).toBe(BODY.length);
    expect(entry.responseSha256).toMatch(/^[0-9a-f]{64}$/);

    const authorization = entry.requestHeaders.find(
      (header) => header.name.toLowerCase() === 'authorization',
    );
    expect(authorization?.value).toBe('[redacted]');
    expect(entry.url).toContain('token=%5Bredacted%5D');

    const raw = await readFile(workspace.historyPath, 'utf8');
    expect(raw).not.toContain(BODY);
    expect(raw).not.toContain('history-token');
    expect(raw).not.toContain('secret-value');
  });

  it('records a failed request with its error', async () => {
    const result = await runCli(
      ['send', `http://127.0.0.1:${closedPort}/`, '--save-history'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    const entries = await readEntries(workspace.historyPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBeNull();
    expect(entries[0]?.error).toContain('The connection failed');
  });

  it('is implied by the historyEnabled setting', async () => {
    await writeFile(
      workspace.configPath,
      `${JSON.stringify({ historyEnabled: true })}\n`,
      'utf8',
    );
    const result = await runCli(['send', server.url('/'), '--quiet'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(await readEntries(workspace.historyPath)).toHaveLength(1);
  });
});

describe('history list', () => {
  it('prints one line per entry and a count', async () => {
    await runCli(['send', server.url('/one'), '--save-history', '--quiet'], {
      env: workspace.env,
    });
    await runCli(['send', server.url('/two'), '--save-history', '--quiet'], {
      env: workspace.env,
    });
    const result = await runCli(['history', 'list'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('200  GET');
    expect(result.stdout).toContain('/one');
    expect(result.stdout).toContain('/two');
    expect(result.stdout).toContain('2 entries.');
  });

  it('honours --limit', async () => {
    await runCli(['send', server.url('/one'), '--save-history', '--quiet'], {
      env: workspace.env,
    });
    await runCli(['send', server.url('/two'), '--save-history', '--quiet'], {
      env: workspace.env,
    });
    const result = await runCli(['history', 'list', '--limit', '1'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('/two');
    expect(result.stdout).not.toContain('/one');
    expect(result.stdout).toContain('1 entry.');
  });

  it('is the default subcommand', async () => {
    const result = await runCli(['history'], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No history recorded.');
  });
});

describe('history list --json', () => {
  it('wraps the entries in the usual envelope', async () => {
    await runCli(['send', server.url('/j'), '--save-history', '--quiet'], {
      env: workspace.env,
    });
    const result = await runCli(['history', 'list', '--json'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    const report = parseReport(result.stdout);
    expect(report['command']).toBe('history');
    const payload = report['result'] as {
      path: string;
      count: number;
      entries: HistoryEntry[];
    };
    expect(payload.path).toBe(workspace.historyPath);
    expect(payload.count).toBe(1);
    expect(payload.entries[0]?.url).toContain('/j');
  });
});

describe('history clear and path', () => {
  it('removes every entry and says how many', async () => {
    await runCli(['send', server.url('/c'), '--save-history', '--quiet'], {
      env: workspace.env,
    });
    const cleared = await runCli(['history', 'clear'], {
      env: workspace.env,
    });
    expect(cleared.code).toBe(0);
    expect(cleared.stdout).toContain('Removed 1 entry from');
    const listed = await runCli(['history', 'list'], {
      env: workspace.env,
    });
    expect(listed.stdout).toContain('No history recorded.');
  });

  it('prints the file location', async () => {
    const result = await runCli(['history', 'path'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(workspace.historyPath);
  });

  it('rejects an unknown subcommand', async () => {
    const result = await runCli(['history', 'purge'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a history subcommand');
  });
});

describe('retention', () => {
  it('keeps only historyMaxEntries of the most recent entries', async () => {
    await writeFile(
      workspace.configPath,
      `${JSON.stringify({ historyMaxEntries: 2 })}\n`,
      'utf8',
    );
    for (const path of ['/r1', '/r2', '/r3']) {
      const result = await runCli(
        ['send', server.url(path), '--save-history', '--quiet'],
        { env: workspace.env },
      );
      expect(result.code).toBe(0);
    }
    const entries = await readEntries(workspace.historyPath);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.url).toContain('/r2');
    expect(entries[1]?.url).toContain('/r3');
  });
});
