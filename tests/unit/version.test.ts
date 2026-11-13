// The release number.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/version.js';

describe('VERSION', () => {
  it('agrees with the version field in package.json', () => {
    const path = fileURLToPath(new URL('../../package.json', import.meta.url));
    const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const version =
      manifest !== null && typeof manifest === 'object' && 'version' in manifest
        ? manifest.version
        : undefined;
    expect(VERSION).toBe(version);
  });
});
