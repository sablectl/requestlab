// Credential redaction.
//
// Redaction happens on the way out of the core, not on the way into the
// formatter: a value that is never carried into a report cannot be printed by
// a future formatter that forgot about it. The same function is used for
// terminal output, JSON output and history records.

import type { HeaderPair } from './types.js';

export const REDACTED = '[redacted]';

/** Header names whose value is a credential, lower-cased. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-authentication-token',
  'x-access-token',
  'x-session-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-amz-security-token',
  'x-goog-api-key',
  'authentication',
  'www-authenticate',
  'proxy-authenticate',
]);

/** Query parameter names that commonly carry a credential, lower-cased. */
const SENSITIVE_PARAMS = new Set([
  'access_token',
  'accesstoken',
  'api_key',
  'apikey',
  'auth',
  'auth_token',
  'authtoken',
  'client_secret',
  'code',
  'id_token',
  'key',
  'password',
  'passwd',
  'pwd',
  'refresh_token',
  'secret',
  'session',
  'sessionid',
  'sig',
  'signature',
  'token',
  'x-api-key',
]);

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}

export function isSensitiveParam(name: string): boolean {
  return SENSITIVE_PARAMS.has(name.toLowerCase());
}

export function redactHeaders(
  headers: readonly HeaderPair[],
): readonly HeaderPair[] {
  return headers.map((header) =>
    isSensitiveHeader(header.name)
      ? { name: header.name, value: REDACTED }
      : header,
  );
}

/**
 * Replace credentials in a URL: user information and the values of
 * credential-shaped query parameters. The structure is preserved so that the
 * result is still recognisable as the request that was made.
 */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    parsed.username = REDACTED;
    parsed.password = '';
  }
  const params = parsed.searchParams;
  const names = [...new Set([...params.keys()])];
  for (const name of names) {
    if (!isSensitiveParam(name)) continue;
    const count = params.getAll(name).length;
    params.delete(name);
    for (let i = 0; i < count; i += 1) params.append(name, REDACTED);
  }
  return parsed.toString();
}

const BEARER = /\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

/**
 * Best-effort redaction of credential-shaped substrings in free text, used for
 * response-body previews.
 *
 * This is a safety net, not a guarantee. A body can carry a secret in any
 * shape; `--no-body` is the only way to be certain that none is printed.
 */
export function redactText(text: string): string {
  return text
    .replace(BEARER, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(JWT, REDACTED);
}
