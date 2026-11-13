// Colour support.
//
// Colour is decoration. Every status reported in colour is also stated in
// words, so monochrome output loses nothing. Piped output is monochrome by
// default and is byte-identical whichever setting suppressed the colour.

export interface ColourInputs {
  readonly noColorFlag: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly isTty: boolean;
}

/** Precedence: --no-color, NO_COLOR, TERM=dumb, FORCE_COLOR, TTY detection. */
export function shouldUseColour(inputs: ColourInputs): boolean {
  if (inputs.noColorFlag) return false;
  const { env } = inputs;
  const noColor = env['NO_COLOR'];
  if (noColor !== undefined && noColor !== '') return false;
  if (env['TERM'] === 'dumb') return false;
  const force = env['FORCE_COLOR'];
  if (force !== undefined && force !== '' && force !== '0') return true;
  return inputs.isTty;
}

export type Style =
  'reset' | 'bold' | 'dim' | 'red' | 'green' | 'yellow' | 'blue' | 'cyan';

const CODES: Record<Style, string> = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
};

export interface Painter {
  (text: string, style: Style): string;
  readonly enabled: boolean;
}

export function createPainter(enabled: boolean): Painter {
  const paint = (text: string, style: Style): string =>
    enabled ? `${CODES[style]}${text}${CODES.reset}` : text;
  return Object.assign(paint, { enabled });
}
