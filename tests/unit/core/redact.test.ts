// Credential redaction.

import { describe, expect, it } from 'vitest';
import {
  isSensitiveHeader,
  isSensitiveParam,
  REDACTED,
  redactHeaders,
  redactText,
  redactUrl,
} from '../../../src/core/redact.js';

describe('isSensitiveHeader', () => {
  it('matches known credential headers regardless of case', () => {
    expect(isSensitiveHeader('Authorization')).toBe(true);
    expect(isSensitiveHeader('AUTHORIZATION')).toBe(true);
    expect(isSensitiveHeader('set-cookie')).toBe(true);
    expect(isSensitiveHeader('X-Api-Key')).toBe(true);
  });

  it('leaves ordinary headers alone', () => {
    expect(isSensitiveHeader('Content-Type')).toBe(false);
    expect(isSensitiveHeader('accept')).toBe(false);
  });
});

describe('isSensitiveParam', () => {
  it('matches credential-shaped parameter names', () => {
    expect(isSensitiveParam('Access_Token')).toBe(true);
    expect(isSensitiveParam('signature')).toBe(true);
    expect(isSensitiveParam('page')).toBe(false);
  });
});

describe('redactHeaders', () => {
  it('replaces sensitive values and keeps the rest untouched', () => {
    const headers = [
      { name: 'Authorization', value: 'Bearer abcdefghijkl' },
      { name: 'content-type', value: 'application/json' },
      { name: 'COOKIE', value: 'session=1' },
      { name: 'X-Trace', value: 'abc' },
    ];
    expect(redactHeaders(headers)).toEqual([
      { name: 'Authorization', value: REDACTED },
      { name: 'content-type', value: 'application/json' },
      { name: 'COOKIE', value: REDACTED },
      { name: 'X-Trace', value: 'abc' },
    ]);
  });

  it('preserves the original name and the header order', () => {
    const redacted = redactHeaders([
      { name: 'X-API-Key', value: 'secret' },
      { name: 'Accept', value: '*/*' },
    ]);
    expect(redacted.map((header) => header.name)).toEqual([
      'X-API-Key',
      'Accept',
    ]);
  });

  it('returns the same object for an untouched header', () => {
    const header = { name: 'Accept', value: '*/*' };
    expect(redactHeaders([header])[0]).toBe(header);
  });
});

describe('redactUrl', () => {
  it('removes user information', () => {
    // The placeholder is percent-encoded, as user information must be.
    expect(redactUrl('https://alice:hunter2@example.com/p')).toBe(
      `https://${encodeURIComponent(REDACTED)}@example.com/p`,
    );
    expect(
      new URL(redactUrl('https://alice:hunter2@example.com/p')).password,
    ).toBe('');
  });

  it('redacts sensitive query parameters and keeps the others', () => {
    // A redacted parameter is rewritten, which moves it to the end.
    expect(redactUrl('https://example.com/?token=abc&page=2&API_KEY=xyz')).toBe(
      `https://example.com/?page=2&token=${encodeURIComponent(REDACTED)}` +
        `&API_KEY=${encodeURIComponent(REDACTED)}`,
    );
  });

  it('redacts every occurrence of a repeated parameter', () => {
    const redacted = redactUrl('https://example.com/?key=a&key=b&q=1');
    const params = new URL(redacted).searchParams;
    expect(params.getAll('key')).toEqual([REDACTED, REDACTED]);
    expect(params.get('q')).toBe('1');
  });

  it('leaves a URL without credentials unchanged', () => {
    expect(redactUrl('https://example.com/a?page=2')).toBe(
      'https://example.com/a?page=2',
    );
  });

  it('returns a string that is not a URL unchanged', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('redactText', () => {
  it('redacts bearer, basic and token credentials, keeping the scheme', () => {
    expect(redactText('Authorization: Bearer abcdefghijklmnop')).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
    expect(redactText('basic QWxhZGRpbjpvcGVuc2VzYW1l')).toBe(
      `basic ${REDACTED}`,
    );
    expect(redactText('token 0123456789abcdef')).toBe(`token ${REDACTED}`);
  });

  it('redacts a JSON Web Token anywhere in the text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    expect(redactText(`{"id_token":"${jwt}"}`)).toBe(
      `{"id_token":"${REDACTED}"}`,
    );
  });

  it('leaves text without credentials unchanged', () => {
    expect(redactText('{"page":2,"total":10}')).toBe('{"page":2,"total":10}');
  });

  it('does not redact a short value after a scheme word', () => {
    expect(redactText('bearer abc')).toBe('bearer abc');
  });
});
