#!/usr/bin/env node
// Entry point. The only file that touches the process.

import { ExitCode } from '../core/errors.js';
import { run } from '../cli/run.js';

const controller = new AbortController();
let interrupted = false;

process.on('SIGINT', () => {
  interrupted = true;
  controller.abort();
});

// A pipe closed by the reader (`| head`) is an ordinary end to the output,
// not a failure to report.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(ExitCode.Success);
});

const code = await run({
  argv: process.argv.slice(2),
  env: process.env,
  stdin: process.stdin,
  stdoutIsTty: process.stdout.isTTY,
  write: (text) => {
    process.stdout.write(text);
  },
  writeError: (text) => {
    process.stderr.write(text);
  },
  signal: controller.signal,
});

process.exitCode = interrupted ? ExitCode.Interrupted : code;
