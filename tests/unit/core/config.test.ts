// Configuration file handling.

import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configPath,
  DEFAULT_SETTINGS,
  isSettingKey,
  loadSettings,
  loadStoredPatch,
  parseSettings,
  saveSettings,
  SETTING_KEYS,
  stateDir,
} from '../../../src/core/config.js';
import { AppError } from '../../../src/core/errors.js';

describe('SETTING_KEYS', () => {
  it('names every setting', () => {
    expect([...SETTING_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS).sort(),
    );
  });

  it('recognises a known key only', () => {
    expect(isSettingKey('timeoutMs')).toBe(true);
    expect(isSettingKey('timeout')).toBe(false);
  });
});

describe('parseSettings', () => {
  it('accepts valid values of each kind', () => {
    expect(
      parseSettings(
        {
          timeoutMs: 1000,
          restrictDestinations: true,
          userAgent: 'test/1.0',
        },
        'test',
      ),
    ).toEqual({
      timeoutMs: 1000,
      restrictDestinations: true,
      userAgent: 'test/1.0',
    });
  });

  it('accepts the string spelling of numbers and booleans', () => {
    expect(
      parseSettings({ maxRedirects: '3', historyEnabled: 'false' }, 'test'),
    ).toEqual({ maxRedirects: 3, historyEnabled: false });
  });

  it('accepts an empty object', () => {
    expect(parseSettings({}, 'test')).toEqual({});
  });

  it('refuses an unknown key', () => {
    let caught: unknown;
    try {
      parseSettings({ nope: 1 }, 'test');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('config-invalid');
    expect((caught as AppError).message).toBe(
      'test: "nope" is not a known setting.',
    );
    expect((caught as AppError).hint).toContain('Known settings:');
  });

  it('refuses anything that is not a JSON object', () => {
    for (const input of [null, 'text', 42, [1, 2]]) {
      expect(() => parseSettings(input, 'test')).toThrow(
        'test: expected a JSON object.',
      );
    }
  });

  it('refuses a number of the wrong type, sign or precision', () => {
    for (const value of [-1, 1.5, 'abc', true, null]) {
      expect(() => parseSettings({ timeoutMs: value }, 'test')).toThrow(
        'test: "timeoutMs" must be a non-negative whole number.',
      );
    }
  });

  it('refuses a boolean that is not a boolean', () => {
    expect(() => parseSettings({ historyEnabled: 'yes' }, 'test')).toThrow(
      'test: "historyEnabled" must be true or false.',
    );
  });

  it('refuses an empty or non-string user agent', () => {
    expect(() => parseSettings({ userAgent: '' }, 'test')).toThrow(
      'test: "userAgent" must be a non-empty string.',
    );
    expect(() => parseSettings({ userAgent: 7 }, 'test')).toThrow(
      'test: "userAgent" must be a non-empty string.',
    );
  });
});

describe('configPath', () => {
  it('prefers REQUESTLAB_CONFIG', () => {
    expect(
      configPath({
        REQUESTLAB_CONFIG: '/tmp/rl.json',
        XDG_CONFIG_HOME: '/tmp/xdg',
      }),
    ).toBe('/tmp/rl.json');
  });

  it('falls back to XDG_CONFIG_HOME', () => {
    expect(configPath({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe(
      join('/tmp/xdg', 'requestlab', 'config.json'),
    );
  });

  it('ignores an empty value', () => {
    expect(
      configPath({ REQUESTLAB_CONFIG: '', XDG_CONFIG_HOME: '/tmp/xdg' }),
    ).toBe(join('/tmp/xdg', 'requestlab', 'config.json'));
  });
});

describe('stateDir', () => {
  it('prefers REQUESTLAB_STATE_DIR', () => {
    expect(
      stateDir({
        REQUESTLAB_STATE_DIR: '/tmp/state',
        XDG_STATE_HOME: '/tmp/xdg',
      }),
    ).toBe('/tmp/state');
  });

  it('falls back to XDG_STATE_HOME', () => {
    expect(stateDir({ XDG_STATE_HOME: '/tmp/xdg' })).toBe(
      join('/tmp/xdg', 'requestlab'),
    );
  });
});

describe('loadSettings and saveSettings', () => {
  let directory: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'requestlab-config-'));
    env = { REQUESTLAB_CONFIG: join(directory, 'nested', 'config.json') };
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('returns the defaults when no file exists', async () => {
    const loaded = await loadSettings(env);
    expect(loaded.exists).toBe(false);
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
    expect(loaded.path).toBe(env['REQUESTLAB_CONFIG']);
  });

  it('returns an empty patch when no file exists', async () => {
    expect(await loadStoredPatch(env)).toEqual({});
  });

  it('writes a file readable only by its owner and reads it back', async () => {
    const path = await saveSettings({ timeoutMs: 1234 }, env);
    const info = await stat(path);
    expect(info.mode & 0o777).toBe(0o600);

    const loaded = await loadSettings(env);
    expect(loaded.exists).toBe(true);
    expect(loaded.settings).toEqual({
      ...DEFAULT_SETTINGS,
      timeoutMs: 1234,
    });
    expect(await loadStoredPatch(env)).toEqual({ timeoutMs: 1234 });
  });

  it('refuses a file that is not valid JSON', async () => {
    await saveSettings({}, env);
    await writeFile(env['REQUESTLAB_CONFIG'] ?? '', '{nope');
    await expect(loadSettings(env)).rejects.toThrow('is not valid JSON.');
  });

  it('refuses a file with an unknown setting', async () => {
    await saveSettings({}, env);
    await writeFile(env['REQUESTLAB_CONFIG'] ?? '', '{"nope":1}');
    await expect(loadSettings(env)).rejects.toThrow(
      '"nope" is not a known setting.',
    );
    await expect(loadStoredPatch(env)).rejects.toBeInstanceOf(AppError);
  });
});
