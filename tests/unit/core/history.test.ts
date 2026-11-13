// Local request history.

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendHistory,
  applyRetention,
  clearHistory,
  entryFromExchange,
  entryFromFailure,
  historyPath,
  readHistory,
  type HistoryEntry,
  type RetentionPolicy,
} from '../../../src/core/history.js';
import { REDACTED } from '../../../src/core/redact.js';
import { makeExchange, makeHop } from '../helpers/exchange.js';

// A window wide enough that the fixed timestamps below never age out.
const POLICY: RetentionPolicy = { maxEntries: 100, maxAgeDays: 36_500 };

function makeEntry(at: string, url = 'https://example.com/'): HistoryEntry {
  return {
    at,
    method: 'GET',
    url,
    status: 200,
    statusText: 'OK',
    finalUrl: url,
    redirects: 0,
    requestHeaders: [],
    responseHeaders: [],
    requestBodyBytes: 0,
    responseBodyBytes: 0,
    responseSha256: null,
    totalMs: 1,
    error: null,
  };
}

describe('entryFromExchange', () => {
  it('redacts credentials and records no body content', () => {
    const entry = entryFromExchange(
      makeExchange({
        request: {
          url: 'https://user:pass@example.com/?token=abcdef',
          headers: [
            { name: 'Authorization', value: 'Bearer abcdefghijkl' },
            { name: 'Accept', value: '*/*' },
          ],
          bodyBytes: 5,
          bodySource: 'text',
        },
        redirects: [makeHop({ status: 302 })],
        final: {
          url: 'https://example.com/?api_key=xyz',
          headers: [{ name: 'Set-Cookie', value: 'a=b' }],
        },
        timing: { totalMs: 120.6 },
      }),
    );
    expect(entry.url).toContain(
      `https://${encodeURIComponent(REDACTED)}@example.com/`,
    );
    expect(entry.url).not.toContain('abcdef');
    expect(entry.finalUrl).not.toContain('xyz');
    expect(entry.requestHeaders).toEqual([
      { name: 'Authorization', value: REDACTED },
      { name: 'Accept', value: '*/*' },
    ]);
    expect(entry.responseHeaders).toEqual([
      { name: 'Set-Cookie', value: REDACTED },
    ]);
    expect(entry.redirects).toBe(1);
    expect(entry.totalMs).toBe(121);
    expect(Object.keys(entry)).not.toContain('preview');
    expect(JSON.stringify(entry)).not.toContain('{"ok":true}');
  });
});

describe('entryFromFailure', () => {
  it('records the message and redacts the URL', () => {
    const entry = entryFromFailure(
      'POST',
      'https://example.com/?password=hunter2',
      '2026-01-01T00:00:00.000Z',
      [{ name: 'Cookie', value: 'a=b' }],
      'The connection failed.',
    );
    expect(entry.status).toBeNull();
    expect(entry.error).toBe('The connection failed.');
    expect(entry.url).not.toContain('hunter2');
    expect(entry.requestHeaders).toEqual([{ name: 'Cookie', value: REDACTED }]);
  });
});

describe('applyRetention', () => {
  const now = Date.parse('2026-01-31T00:00:00.000Z');

  it('drops entries older than the age limit', () => {
    const kept = applyRetention(
      [
        makeEntry('2025-12-01T00:00:00.000Z'),
        makeEntry('2026-01-30T00:00:00.000Z'),
      ],
      { maxEntries: 10, maxAgeDays: 7 },
      now,
    );
    expect(kept.map((entry) => entry.at)).toEqual(['2026-01-30T00:00:00.000Z']);
  });

  it('trims to the most recent entries', () => {
    const kept = applyRetention(
      [
        makeEntry('2026-01-28T00:00:00.000Z'),
        makeEntry('2026-01-29T00:00:00.000Z'),
        makeEntry('2026-01-30T00:00:00.000Z'),
      ],
      { maxEntries: 2, maxAgeDays: 30 },
      now,
    );
    expect(kept.map((entry) => entry.at)).toEqual([
      '2026-01-29T00:00:00.000Z',
      '2026-01-30T00:00:00.000Z',
    ]);
  });

  it('keeps nothing when no entries are allowed', () => {
    expect(
      applyRetention(
        [makeEntry('2026-01-30T00:00:00.000Z')],
        {
          maxEntries: 0,
          maxAgeDays: 30,
        },
        now,
      ),
    ).toEqual([]);
  });

  it('drops an entry whose timestamp cannot be read', () => {
    expect(applyRetention([makeEntry('not a date')], POLICY, now)).toEqual([]);
  });
});

describe('the history file', () => {
  let directory: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'requestlab-history-'));
    env = { REQUESTLAB_STATE_DIR: join(directory, 'state') };
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('places the file inside the state directory', () => {
    expect(historyPath(env)).toBe(join(directory, 'state', 'history.jsonl'));
  });

  it('reads an empty history when no file exists', async () => {
    expect(await readHistory(env)).toEqual([]);
  });

  it('appends, reads back and clears, owner-readable only', async () => {
    await appendHistory(makeEntry('2026-01-01T00:00:00.000Z'), POLICY, env);
    await appendHistory(makeEntry('2026-01-02T00:00:00.000Z'), POLICY, env);

    const entries = await readHistory(env);
    expect(entries.map((entry) => entry.at)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    ]);

    const info = await stat(historyPath(env));
    expect(info.mode & 0o777).toBe(0o600);

    expect(await clearHistory(env)).toBe(2);
    expect(await readHistory(env)).toEqual([]);
    expect(await readFile(historyPath(env), 'utf8')).toBe('');
  });

  it('applies the retention policy as entries are appended', async () => {
    for (const day of ['01', '02', '03']) {
      await appendHistory(
        makeEntry(`2026-01-${day}T00:00:00.000Z`),
        { maxEntries: 2, maxAgeDays: 36_500 },
        env,
      );
    }
    const entries = await readHistory(env);
    expect(entries.map((entry) => entry.at)).toEqual([
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
    ]);
  });

  it('skips a corrupt line rather than discarding the file', async () => {
    await appendHistory(makeEntry('2026-01-01T00:00:00.000Z'), POLICY, env);
    const path = historyPath(env);
    await writeFile(path, `${await readFile(path, 'utf8')}{"at":"truncated"\n`);
    const entries = await readHistory(env);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.at).toBe('2026-01-01T00:00:00.000Z');
  });
});
