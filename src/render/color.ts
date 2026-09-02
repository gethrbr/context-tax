/**
 * Colour, and the ability to turn it off.
 *
 * Honours `NO_COLOR` (the de-facto standard) and a non-TTY stdout, so piping into a file or a pager
 * yields plain text without anybody asking for a flag. Zero dependencies: the escape codes are six
 * strings, and taking a dependency for them would buy a supply-chain surface for nothing.
 */

export interface Palette {
  dim: (text: string) => string;
  bold: (text: string) => string;
  green: (text: string) => string;
  yellow: (text: string) => string;
  red: (text: string) => string;
  cyan: (text: string) => string;
}

const plain: Palette = {
  dim: (text) => text,
  bold: (text) => text,
  green: (text) => text,
  yellow: (text) => text,
  red: (text) => text,
  cyan: (text) => text,
};

const wrap =
  (code: string) =>
  (text: string): string =>
    `\u001b[${code}m${text}\u001b[0m`;

const coloured: Palette = {
  dim: wrap('2'),
  bold: wrap('1'),
  green: wrap('32'),
  yellow: wrap('33'),
  red: wrap('31'),
  cyan: wrap('36'),
};

export function palette(enabled: boolean): Palette {
  return enabled ? coloured : plain;
}

/** `--color` asked for, `NO_COLOR` not set, and something on the other end that can render it. */
export function colourEnabled(flag: boolean): boolean {
  if (!flag) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  return process.stdout.isTTY === true;
}
