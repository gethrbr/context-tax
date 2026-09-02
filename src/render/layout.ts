/**
 * Terminal width, and text that respects it.
 *
 * 🚨 The screens were written as if the terminal were infinitely wide. It is not, so every line
 * of prose longer than the window hard-wrapped at column 0, and a two-space indent turned into a
 * left margin the reader could not follow. The table columns lined up perfectly and the page still
 * looked broken, because the sentences under each row did not.
 *
 * Wrapping happens on raw text and colour is applied per line afterwards, never the other way
 * round: an escape sequence counts toward `.length`, so wrapping a coloured string measures the
 * escape codes as if they were letters and breaks the line in the wrong place.
 */

import { homedir } from 'node:os';

/**
 * A path is one word, so wrapping it splits it in the middle and it stops being a path you can
 * paste. Shortening the home directory to `~` recovers most of the width, and an over-long
 * remainder loses its middle rather than its end: the file name is the half you were reading for.
 */
export function shortPath(path: string, width: number, home = homedir()): string {
  const short = home.length > 1 && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  if (short.length <= width || width < 12) return short;
  const tail = Math.floor((width - 1) * 0.6);
  return `${short.slice(0, width - 1 - tail)}…${short.slice(-tail)}`;
}

/** Prose stops being readable past this, however wide the window is. */
const MAX = 96;
/** Below this the columns cannot line up at all, so we stop shrinking and let it overflow. */
const MIN = 64;

export function screenWidth(columns: number | undefined = process.stdout.columns): number {
  if (columns === undefined || Number.isNaN(columns)) return 80;
  return Math.max(MIN, Math.min(MAX, columns));
}

/**
 * Greedy word wrap. A word longer than the line is split rather than allowed to overhang, which is
 * what a URL or a server's JSON error body does.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter((part) => part.length > 0)) {
    let piece = word;
    while (piece.length > width) {
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      lines.push(piece.slice(0, width));
      piece = piece.slice(width);
    }
    if (current.length === 0) current = piece;
    else if (current.length + 1 + piece.length <= width) current += ` ${piece}`;
    else {
      lines.push(current);
      current = piece;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length === 0 ? [''] : lines;
}

/**
 * Wrap, then cap. A server that fails with a wall of JSON gets to say so, but it does not get to
 * own the screen: the reason is diagnostic, and the whole body is one `--json` away.
 */
export function wrapClamped(text: string, width: number, maxLines: number): string[] {
  const lines = wrapText(text, width);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = `${last.slice(0, Math.max(0, width - 1)).trimEnd()}…`;
  return kept;
}

/** A horizontal rule, which is what turns aligned numbers into a table the eye reads as one. */
export function rule(width: number): string {
  return '─'.repeat(Math.max(0, width));
}

/**
 * Wrap with the first line at `indent` and every continuation under it at `indent + hang`, which
 * is what keeps a wrapped list of servers from reading as a new paragraph.
 */
export function hangingText(
  text: string,
  width: number,
  indent: number,
  hang: number,
): string[] {
  return wrapText(text, width - indent - hang).map(
    (part, at) => `${' '.repeat(at === 0 ? indent : indent + hang)}${part}`,
  );
}
