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

/** `$HOME` is noise in every path this tool prints, and it is the half that never varies. */
export function shortenHome(text: string, home = homedir()): string {
  if (home.length <= 1) return text;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`${escaped}(?=/|\\s|$)`, 'g'), '~');
}

/** A word that is a path, and therefore a word that must not be broken. */
const PATH_LIKE = /^(?:~|\/)\S*$/;

/**
 * Wrap an instruction whose last word is the file you are being told to edit.
 *
 * 🚨 A fix line is the one line on the screen the reader is meant to act on, and it was clamped
 * like the diagnostic prose above it: three lines, then an `…`. What the `…` ate was the path.
 * The instruction that survived named a file the reader could not open, which is worse than no
 * instruction. Nothing here is elided, and nothing needs to be: unlike a server's failure reason,
 * which is a wall of JSON and stays clamped, a fix is tool-authored prose plus one path.
 *
 * Two things make that affordable. `$HOME` is collapsed to `~`, which is most of the width back
 * on a real machine and puts the usual path on one line; and a path too long even for that starts
 * on its own line, so its fragments align instead of trailing off the end of a sentence. It is
 * still hard wrapped rather than allowed to overhang, because every screen fitting the window it
 * was given is a promise this file exists to keep.
 */
export function wrapInstruction(text: string, width: number, home = homedir()): string[] {
  const shortened = shortenHome(text, home);
  const words = shortened.split(/\s+/).filter((part) => part.length > 0);
  const path = words[words.length - 1];
  // A path that fits is already safe: the greedy wrap never splits a word it has room for. Leaving
  // that case alone is what keeps every screen that renders today byte-identical.
  if (path === undefined || !PATH_LIKE.test(path) || path.length <= width) {
    return wrapText(shortened, width);
  }
  const head = words.slice(0, -1).join(' ');
  return [...(head.length > 0 ? wrapText(head, width) : []), ...wrapText(path, width)];
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
