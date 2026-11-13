// Request body preparation.
//
// A body is read once, before the request starts, so that its length is known
// and a file that cannot be read fails before anything is sent.

import { readFile, stat } from 'node:fs/promises';
import { AppError } from './errors.js';
import type { PreparedBody } from './types.js';

/** Refuses a request body larger than this unless the caller raises it. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;

export function textBody(text: string): PreparedBody {
  return {
    bytes: Buffer.from(text, 'utf8'),
    contentType: 'text/plain; charset=utf-8',
    source: 'text',
  };
}

export function jsonBody(text: string): PreparedBody {
  try {
    JSON.parse(text);
  } catch (error) {
    throw new AppError(
      'usage',
      `The JSON body is not valid JSON: ${
        error instanceof Error ? error.message : 'parse failed'
      }.`,
    );
  }
  return {
    bytes: Buffer.from(text, 'utf8'),
    contentType: 'application/json',
    source: 'json',
  };
}

/**
 * Read a body from a local file.
 *
 * The path is used exactly as given — RequestLab is a local tool run by the
 * person whose files these are, so there is no sandbox to escape — but the
 * size is checked before reading so that a very large or special file cannot
 * exhaust memory.
 */
export async function fileBody(
  path: string,
  maxBytes: number = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<PreparedBody> {
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new AppError('usage', `${path} is not a regular file.`);
    }
    size = info.size;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('usage', `${path} cannot be read.`);
  }
  if (size > maxBytes) {
    throw new AppError(
      'usage',
      `${path} is ${size} bytes, above the ${maxBytes}-byte request body limit.`,
    );
  }
  const bytes = await readFile(path);
  return { bytes, source: 'file' };
}

export async function stdinBody(
  stream: NodeJS.ReadableStream,
  maxBytes: number = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<PreparedBody> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new AppError(
        'usage',
        `Standard input exceeded the ${maxBytes}-byte request body limit.`,
      );
    }
    chunks.push(buffer);
  }
  return { bytes: Buffer.concat(chunks), source: 'stdin' };
}
