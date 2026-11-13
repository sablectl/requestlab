// The config command and the stored settings file.

import { readFile, rm, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Settings } from '../../src/core/config.js';
import {
  createWorkspace,
  parseReport,
  runCli,
  startServer,
} from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;

beforeAll(async () => {
  workspace = await createWorkspace('config');
  server = await startServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end('ok');
  });
});

beforeEach(async () => {
  await rm(workspace.configPath, { force: true });
});

afterAll(async () => {
  await server.close();
  await workspace.cleanup();
});

describe('config show', () => {
  it('lists the defaults and says the file is not written yet', async () => {
    const result = await runCli(['config', 'show'], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`${workspace.configPath} (not written`);
    expect(result.stdout).toContain('timeoutMs');
    expect(result.stdout).toContain('30000 (default)');
    expect(result.stdout).toContain('userAgent');
  });

  it('is the default subcommand', async () => {
    const result = await runCli(['config'], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('historyEnabled');
  });

  it('drops the default marker once a value is stored', async () => {
    await runCli(['config', 'set', 'timeoutMs', '4321'], {
      env: workspace.env,
    });
    const result = await runCli(['config', 'show'], { env: workspace.env });
    expect(result.stdout).toContain('4321');
    expect(result.stdout).not.toContain('4321 (default)');
  });
});

describe('config show --json', () => {
  it('reports the path, whether it exists and every setting', async () => {
    const result = await runCli(['config', 'show', '--json'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    const report = parseReport(result.stdout);
    expect(report['command']).toBe('config');
    const payload = report['result'] as {
      path: string;
      exists: boolean;
      settings: Settings;
    };
    expect(payload.path).toBe(workspace.configPath);
    expect(payload.exists).toBe(false);
    expect(payload.settings.timeoutMs).toBe(30_000);
    expect(payload.settings.historyEnabled).toBe(false);
    expect(payload.settings.userAgent).toBe('requestlab/1.0.0');
  });

  it('says the file exists once it has been written', async () => {
    await runCli(['config', 'set', 'historyMaxEntries', '7'], {
      env: workspace.env,
    });
    const result = await runCli(['config', 'show', '--json'], {
      env: workspace.env,
    });
    const payload = parseReport(result.stdout)['result'] as {
      exists: boolean;
      settings: Settings;
    };
    expect(payload.exists).toBe(true);
    expect(payload.settings.historyMaxEntries).toBe(7);
  });
});

describe('config path', () => {
  it('prints the file location', async () => {
    const result = await runCli(['config', 'path'], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(workspace.configPath);
  });
});

describe('config set and unset', () => {
  it('round trips a value through the file', async () => {
    const written = await runCli(['config', 'set', 'userAgent', 'probe/2'], {
      env: workspace.env,
    });
    expect(written.code).toBe(0);
    expect(written.stdout).toContain(
      `userAgent set in ${workspace.configPath}`,
    );
    expect(JSON.parse(await readFile(workspace.configPath, 'utf8'))).toEqual({
      userAgent: 'probe/2',
    });

    const removed = await runCli(['config', 'unset', 'userAgent'], {
      env: workspace.env,
    });
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('userAgent removed from');
    expect(JSON.parse(await readFile(workspace.configPath, 'utf8'))).toEqual(
      {},
    );
  });

  it('keeps other stored settings when one is changed', async () => {
    await runCli(['config', 'set', 'userAgent', 'probe/3'], {
      env: workspace.env,
    });
    await runCli(['config', 'set', 'maxRedirects', '9'], {
      env: workspace.env,
    });
    expect(JSON.parse(await readFile(workspace.configPath, 'utf8'))).toEqual({
      userAgent: 'probe/3',
      maxRedirects: 9,
    });
  });

  it('applies a stored setting to a request', async () => {
    await runCli(['config', 'set', 'userAgent', 'configured/1'], {
      env: workspace.env,
    });
    const before = server.requests.length;
    const result = await runCli(['send', server.url('/'), '--quiet'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(server.requests[before]?.headers['user-agent']).toBe('configured/1');
  });

  it('rejects an invalid value with exit 2', async () => {
    const result = await runCli(['config', 'set', 'timeoutMs', 'soon'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('must be a non-negative whole number');
  });

  it('rejects an unknown setting with exit 2', async () => {
    const result = await runCli(['config', 'set', 'colour', 'blue'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a known setting');
  });

  it('rejects set without a value', async () => {
    const result = await runCli(['config', 'set', 'timeoutMs'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('set needs a key and a value');
  });

  it('rejects an unknown subcommand', async () => {
    const result = await runCli(['config', 'reset'], { env: workspace.env });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a config subcommand');
  });
});

describe('a damaged configuration file', () => {
  it('is reported as a usage error, not ignored', async () => {
    await writeFile(workspace.configPath, 'not json at all', 'utf8');
    const result = await runCli(['config', 'show'], { env: workspace.env });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not valid JSON');
  });

  it('refuses an unknown key rather than skipping it', async () => {
    await writeFile(
      workspace.configPath,
      `${JSON.stringify({ nonsense: 1 })}\n`,
      'utf8',
    );
    const result = await runCli(['send', server.url('/')], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a known setting');
  });
});
