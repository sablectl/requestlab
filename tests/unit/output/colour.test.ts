// Colour support.

import { describe, expect, it } from 'vitest';
import { createPainter, shouldUseColour } from '../../../src/output/colour.js';

describe('shouldUseColour', () => {
  it('obeys --no-color above everything else', () => {
    expect(
      shouldUseColour({
        noColorFlag: true,
        env: { FORCE_COLOR: '1' },
        isTty: true,
      }),
    ).toBe(false);
  });

  it('obeys NO_COLOR above FORCE_COLOR', () => {
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { NO_COLOR: '1', FORCE_COLOR: '1' },
        isTty: true,
      }),
    ).toBe(false);
  });

  it('ignores an empty NO_COLOR', () => {
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { NO_COLOR: '' },
        isTty: true,
      }),
    ).toBe(true);
  });

  it('obeys TERM=dumb above FORCE_COLOR', () => {
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { TERM: 'dumb', FORCE_COLOR: '1' },
        isTty: true,
      }),
    ).toBe(false);
  });

  it('honours FORCE_COLOR without a terminal', () => {
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { FORCE_COLOR: '1' },
        isTty: false,
      }),
    ).toBe(true);
  });

  it('ignores FORCE_COLOR when it is empty or zero', () => {
    for (const force of ['', '0']) {
      expect(
        shouldUseColour({
          noColorFlag: false,
          env: { FORCE_COLOR: force },
          isTty: false,
        }),
      ).toBe(false);
    }
  });

  it('falls back to terminal detection', () => {
    expect(shouldUseColour({ noColorFlag: false, env: {}, isTty: true })).toBe(
      true,
    );
    expect(shouldUseColour({ noColorFlag: false, env: {}, isTty: false })).toBe(
      false,
    );
  });
});

describe('createPainter', () => {
  it('returns the text unchanged when colour is disabled', () => {
    const paint = createPainter(false);
    expect(paint.enabled).toBe(false);
    expect(paint('OK', 'green')).toBe('OK');
  });

  it('wraps the text in escape codes when colour is enabled', () => {
    const paint = createPainter(true);
    expect(paint.enabled).toBe(true);
    expect(paint('OK', 'green')).toBe('\u001b[32mOK\u001b[0m');
    expect(paint('OK', 'bold')).toBe('\u001b[1mOK\u001b[0m');
  });
});
