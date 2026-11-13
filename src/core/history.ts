// Local request history.
//
// Off unless the user turns it on, stored only on this machine, and redacted
// before it is written rather than before it is displayed: a credential that
// never reaches the file cannot leak from it afterwards. Request and response
// bodies are never recorded, only their size and digest.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDir } from './config.js';
import { AppError } from './errors.js';
import { redactHeaders, redactUrl } from './redact.js';
import type { Exchange, HeaderPair, HttpMethod } from './types.js';

export interface HistoryEntry {
  readonly at: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly status: number | null;
  readonly statusText: string | null;
  readonly finalUrl: string | null;
  readonly redirects: number;
  readonly requestHeaders: readonly HeaderPair[];
  readonly responseHeaders: readonly HeaderPair[];
  readonly requestBodyBytes: number;
  readonly responseBodyBytes: number | null;
  readonly responseSha256: string | null;
  readonly totalMs: number | null;
  readonly error: string | null;
}

export interface RetentionPolicy {
  readonly maxEntries: number;
  readonly maxAgeDays: number;
}

export function historyPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), 'history.jsonl');
}

export function entryFromExchange(exchange: Exchange): HistoryEntry {
  return {
    at: exchange.startedAt,
    method: exchange.request.method,
    url: redactUrl(exchange.request.url),
    status: exchange.final.status,
    statusText: exchange.final.statusText,
    finalUrl: redactUrl(exchange.final.url),
    redirects: exchange.redirects.length,
    requestHeaders: redactHeaders(exchange.request.headers),
    responseHeaders: redactHeaders(exchange.final.headers),
    requestBodyBytes: exchange.request.bodyBytes,
    responseBodyBytes: exchange.body.bytes,
    responseSha256: exchange.body.sha256,
    totalMs: Math.round(exchange.timing.totalMs),
    error: null,
  };
}

export function entryFromFailure(
  method: HttpMethod,
  url: string,
  startedAt: string,
  requestHeaders: readonly HeaderPair[],
  message: string,
): HistoryEntry {
  return {
    at: startedAt,
    method,
    url: redactUrl(url),
    status: null,
    statusText: null,
    finalUrl: null,
    redirects: 0,
    requestHeaders: redactHeaders(requestHeaders),
    responseHeaders: [],
    requestBodyBytes: 0,
    responseBodyBytes: null,
    responseSha256: null,
    totalMs: null,
    error: message,
  };
}

/** Drop entries older than the retention window, then any excess. */
export function applyRetention(
  entries: readonly HistoryEntry[],
  policy: RetentionPolicy,
  nowMs: number = Date.now(),
): readonly HistoryEntry[] {
  const cutoff = nowMs - policy.maxAgeDays * 24 * 60 * 60 * 1000;
  const fresh = entries.filter((entry) => {
    const at = Date.parse(entry.at);
    return Number.isNaN(at) ? false : at >= cutoff;
  });
  return policy.maxEntries === 0 ? [] : fresh.slice(-policy.maxEntries);
}

function parseLines(text: string): readonly HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === 'object') {
        entries.push(parsed as HistoryEntry);
      }
    } catch {
      // A truncated final line is possible after an interrupted write. One
      // unreadable record is skipped rather than discarding the whole file.
    }
  }
  return entries;
}

export async function readHistory(
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly HistoryEntry[]> {
  try {
    return parseLines(await readFile(historyPath(env), 'utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw new AppError(
      'history-unavailable',
      `The history file could not be read${code === undefined ? '' : ` (${code})`}.`,
    );
  }
}

async function writeAll(
  entries: readonly HistoryEntry[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const path = historyPath(env);
  await mkdir(stateDir(env), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  const text = entries.map((entry) => JSON.stringify(entry)).join('\n');
  await writeFile(temporary, entries.length === 0 ? '' : `${text}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

export async function appendHistory(
  entry: HistoryEntry,
  policy: RetentionPolicy,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const existing = await readHistory(env);
  const kept = applyRetention([...existing, entry], policy);
  await writeAll(kept, env);
}

export async function clearHistory(
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const existing = await readHistory(env);
  await writeAll([], env);
  return existing.length;
}
