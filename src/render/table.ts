/**
 * Bordered tables.
 *
 * 🔑 The border is not decoration. Before it, every row carried its explanation on a second line
 * underneath, so numbers and sentences alternated all the way down the screen and the columns,
 * which were perfectly aligned, never read as a table. Drawing the grid forces the rule that
 * actually fixes it: **one row is one line.** Anything that does not fit in a cell belongs under
 * FINDINGS, where there is room to say it properly.
 *
 * ⚠️ Pad first, colour second. An escape sequence counts toward `.length`, so a cell padded after
 * it is painted lines up under `--no-color` and nowhere else.
 */

import type { Palette } from './color.js';

export interface Column {
  header: string;
  width: number;
  align: 'left' | 'right';
}

export interface Cell {
  text: string;
  paint?: (text: string) => string;
}

/** A group of rows. Sections are separated by a `├───┤` rule, which is what marks the totals off. */
export type Section = Cell[][];

const GLYPHS = {
  top: ['┌', '┬', '┐'],
  middle: ['├', '┼', '┤'],
  bottom: ['└', '┴', '┘'],
} as const;

function fit(text: string, width: number, align: 'left' | 'right'): string {
  if (text.length > width) return `${text.slice(0, width - 1)}…`;
  const padding = ' '.repeat(width - text.length);
  return align === 'right' ? padding + text : text + padding;
}

function edge(columns: Column[], kind: keyof typeof GLYPHS): string {
  const [left, join, right] = GLYPHS[kind];
  return left + columns.map((column) => '─'.repeat(column.width + 2)).join(join) + right;
}

function row(cells: Cell[], columns: Column[], colour: Palette): string {
  const bar = colour.dim('│');
  const painted = columns.map((column, at) => {
    const cell = cells[at] ?? { text: '' };
    const text = fit(cell.text, column.width, column.align);
    return ` ${cell.paint === undefined ? text : cell.paint(text)} `;
  });
  return bar + painted.join(bar) + bar;
}

/**
 * The whole table as lines, already indented. `header` is drawn in its own compartment above the
 * first rule so a wide left-hand column can carry the table's name instead of a separate title.
 */
export function renderTable(
  columns: Column[],
  header: Cell[],
  sections: Section[],
  colour: Palette,
  indent = 2,
): string[] {
  const margin = ' '.repeat(indent);
  const out = [margin + colour.dim(edge(columns, 'top')), margin + row(header, columns, colour)];
  for (const section of sections) {
    out.push(margin + colour.dim(edge(columns, 'middle')));
    for (const cells of section) out.push(margin + row(cells, columns, colour));
  }
  out.push(margin + colour.dim(edge(columns, 'bottom')));
  return out;
}

/** Every column's width, plus the two spaces and the bar each one costs. */
export function tableWidth(columns: Column[], indent = 2): number {
  return indent + columns.reduce((sum, column) => sum + column.width + 3, 0) + 1;
}
