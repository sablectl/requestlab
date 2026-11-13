// Request body preparation.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fileBody,
  jsonBody,
  stdinBody,
  textBody,
} from '../../../src/core/body.js';
import { AppError } from '../../../src/core/errors.js';

describe('textBody', () => {
  it('encodes the text as UTF-8 and declares plain text', () => {
    const body = textBody('héllo');
    expect(Buffer.from(body.bytes).toString('utf8')).toBe('héllo');
    expect(body.bytes.byteLength).toBe(6);
    expect(body.contentType).toBe('text/plain; charset=utf-8');
    expect(body.source).toBe('text');
  });
});

describe('jsonBody', () => {
  it('keeps valid JSON byte for byte and declares the type', () => {
    const body = jsonBody('{ "a": 1 }');
    expect(Buffer.from(body.bytes).toString('utf8')).toBe('{ "a": 1 }');
    expect(body.contentType).toBe('application/json');
    expect(body.source).toBe('json');
  });

  it('refuses text that is not valid JSON', () => {
    let caught: unknown;
    try {
      jsonBody('{nope');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('usage');
    expect((caught as AppError).message).toMatch(
      /^The JSON body is not valid JSON: /,
    );
  });
});

describe('fileBody', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'requestlab-body-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads a file and reports its source', async () => {
    const path = join(directory, 'payload.txt');
    await writeFile(path, 'payload');
    const body = await fileBody(path);
    expect(Buffer.from(body.bytes).toString('utf8')).toBe('payload');
    expect(body.source).toBe('file');
    expect(body.contentType).toBeUndefined();
  });

  it('refuses a file that does not exist', async () => {
    const path = join(directory, 'missing.txt');
    await expect(fileBody(path)).rejects.toThrow(`${path} cannot be read.`);
  });

  it('refuses something that is not a regular file', async () => {
    await expect(fileBody(directory)).rejects.toThrow(
      `${directory} is not a regular file.`,
    );
  });

  it('refuses a file above the size limit', async () => {
    const path = join(directory, 'big.txt');
    await writeFile(path, 'x'.repeat(100));
    await expect(fileBody(path, 10)).rejects.toThrow(
      `${path} is 100 bytes, above the 10-byte request body limit.`,
    );
  });
});

describe('stdinBody', () => {
  it('collects every chunk', async () => {
    const body = await stdinBody(Readable.from(['one', 'two']));
    expect(Buffer.from(body.bytes).toString('utf8')).toBe('onetwo');
    expect(body.source).toBe('stdin');
  });

  it('reads an empty stream as an empty body', async () => {
    const body = await stdinBody(Readable.from([]));
    expect(body.bytes.byteLength).toBe(0);
  });

  it('refuses input above the size limit', async () => {
    await expect(
      stdinBody(Readable.from(['x'.repeat(20)]), 10),
    ).rejects.toThrow(
      'Standard input exceeded the 10-byte request body limit.',
    );
  });
});
