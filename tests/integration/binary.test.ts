// The compiled binary, run as a child process.
//
// Everything else in this suite drives `run` in process. This file is the one
// end-to-end check that the published entry point starts, writes to the real
// streams and sets a real exit code.

import { access } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BINARY,
  createWorkspace,
  runBinary,
  startServer,
} from './helpers/harness.js';
import type { TestServer, Workspace } from './helpers/harness.js';

let server: TestServer;
let workspace: Workspace;

async function built(): Promise<boolean> {
  try {
    await access(BINARY);
    return true;
  } catch {
    return false;
  }
}

const BUILT = await built();

beforeAll(async () => {
  workspace = await createWorkspace('binary');
  server = await startServer((request, response) => {
    if (request.url === '/missing') {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain');
      response.end('not here');
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end('from the binary');
  });
});

afterAll(async () => {
  await server.close();
  await workspace.cleanup();
});

describe.skipIf(!BUILT)(
  'dist/bin/requestlab.js (skipped when dist/ is absent; run npm run build)',
  () => {
    it('prints the release number for --version', async () => {
      const result = await runBinary(['--version'], workspace.env);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('requestlab 1.0.0');
    });

    it('prints the help for --help', async () => {
      const result = await runBinary(['--help'], workspace.env);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('requestlab <command> [options]');
      expect(result.stdout).toContain('Commands:');
    });

    it('performs a request and exits 0', async () => {
      const result = await runBinary(
        ['send', server.url('/live')],
        workspace.env,
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('200');
      expect(result.stdout).toContain('from the binary');
      expect(result.stderr).toBe('');
    });

    it('exits 2 on a usage error and writes to stderr', async () => {
      const result = await runBinary(['nonsense'], workspace.env);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('is not a requestlab command');
      expect(result.stdout).toBe('');
    });

    it('exits 1 with --fail on a 4xx', async () => {
      const result = await runBinary(
        ['send', server.url('/missing'), '--fail', '--quiet'],
        workspace.env,
      );
      expect(result.code).toBe(1);
    });

    it('exits 1 when the connection fails', async () => {
      const result = await runBinary(
        ['send', 'http://127.0.0.1:1/'],
        workspace.env,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('The connection failed');
    });

    it('writes no colour when stdout is a pipe', async () => {
      const result = await runBinary(
        ['send', server.url('/live')],
        workspace.env,
      );
      // eslint-disable-next-line no-control-regex
      expect(result.stdout).not.toMatch(/\u001B\[[0-9;]*m/);
    });
  },
);
