/**
 * A unified diff, in about sixty lines and with no dependency.
 *
 * `--fix` shows the exact change before it writes it, and "exact" has to mean the lines, not a
 * summary of them. A summary is a second description of the edit that can drift from the edit
 * itself, and the whole reason to confirm before writing is that the reader should be checking the
 * thing that will happen rather than a sentence about it.
 *
 * Plain Hirschberg-free LCS: these are settings files of a few hundred lines, so the quadratic
 * table costs microseconds, and a real diff library costs a supply-chain surface for the same
 * output.
 */

export interface DiffLine {
  kind: ' ' | '-' | '+';
  text: string;
}

export interface Hunk {
  beforeStart: number;
  beforeCount: number;
  afterStart: number;
  afterCount: number;
  lines: DiffLine[];
}

/** Beyond this the table stops being free, and no settings file comes close. */
const MAX_CELLS = 4_000_000;

function lines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

function walk(before: string[], after: string[]): DiffLine[] {
  if (before.length * after.length > MAX_CELLS) {
    return [
      ...before.map((text): DiffLine => ({ kind: '-', text })),
      ...after.map((text): DiffLine => ({ kind: '+', text })),
    ];
  }

  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      out.push({ kind: ' ', text: before[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ kind: '-', text: before[i] });
      i += 1;
    } else {
      out.push({ kind: '+', text: after[j] });
      j += 1;
    }
  }
  while (i < before.length) out.push({ kind: '-', text: before[i++] });
  while (j < after.length) out.push({ kind: '+', text: after[j++] });
  return out;
}

/** Changed regions with `context` unchanged lines around each, in `@@` hunks. */
export function unifiedDiff(before: string, after: string, context = 3): Hunk[] {
  const script = walk(lines(before), lines(after));
  const changed = script.map((line) => line.kind !== ' ');
  const keep = script.map(
    (_, index) =>
      changed[index] ||
      changed.slice(Math.max(0, index - context), index + context + 1).some(Boolean),
  );

  const hunks: Hunk[] = [];
  let beforeLine = 1;
  let afterLine = 1;
  let current: Hunk | null = null;
  script.forEach((line, index) => {
    if (keep[index]) {
      current ??= {
        beforeStart: beforeLine,
        beforeCount: 0,
        afterStart: afterLine,
        afterCount: 0,
        lines: [],
      };
      current.lines.push(line);
      if (line.kind !== '+') current.beforeCount += 1;
      if (line.kind !== '-') current.afterCount += 1;
    } else if (current !== null) {
      hunks.push(current);
      current = null;
    }
    if (line.kind !== '+') beforeLine += 1;
    if (line.kind !== '-') afterLine += 1;
  });
  if (current !== null) hunks.push(current);
  return hunks;
}
