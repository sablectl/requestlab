// URL acceptance at the edge of the transport.

import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/core/errors.js';
import { REDACTED } from '../../../src/core/redact.js';
import { parseRequestUrl } from '../../../src/core/transport.js';

describe('parseRequestUrl', () => {
  it('accepts an absolute http or https URL', () => {
    expect(parseRequestUrl('https://example.com/path').host).toBe(
      'example.com',
    );
  });

  it('rejects another scheme', () => {
    expect(() => parseRequestUrl('ftp://files.invalid/thing')).toThrow(
      AppError,
    );
  });

  it('redacts credentials in the rejection message', () => {
    let message = '';
    try {
      parseRequestUrl('://user:s3cret@example.com/path?token=abc123xyz');
    } catch (error) {
      message = (error as AppError).message;
    }
    expect(message).toContain('is not a valid absolute URL');
    expect(message).not.toContain('user');
    expect(message).not.toContain('s3cret');
    expect(message).not.toContain('abc123xyz');
    expect(message).toContain(REDACTED);
  });
});
