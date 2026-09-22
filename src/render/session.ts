/**
 * One session as a picture: in the terminal, and as an SVG to post.
 *
 * 🔑 The picture exists to show one thing a table cannot. A long session is a sawtooth: context
 * climbs, the client compacts, it drops, it climbs again. And the drop never reaches the bottom of
 * the chart. The band it lands on is the fixed prefix, the same tokens the ledger itemises, paid
 * again on the turn after every compaction and on every turn between.
 *
 * 🔒 The SVG carries numbers and nothing else. No path, no session id, no project name: it is made
 * to be posted, and a picture of somebody's working directory is not what they meant to share.
 */

import { downsample, summarize } from '../evidence/series.js';
import type { SessionSeries } from '../evidence/series.js';
import type { Palette } from './color.js';
import { screenWidth, wrapClamped } from './layout.js';

const n = (value: number): string => value.toLocaleString('en-US');

/** `352K`, `1.2M`. An axis label has five characters to work with. */
function short(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${Math.round(value / 1_000)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const CHART_ROWS = 12;
const AXIS = 7;

export interface SessionView {
  series: SessionSeries;
  /**
   * What this session's own first request carried, when the transcript billed one. The
   * floor is compared with this and not with today's prefix: a session from last month ran under
   * last month's config, and setting its floor against this month's total compares two machines.
   */
  openedAt: number | null;
}

/** The sentence under both pictures. One place, so the terminal and the SVG cannot disagree. */
export function sessionCaption(view: SessionView): string {
  const summary = summarize(view.series);
  const compactions =
    summary.compactions === 0
      ? 'never compacted'
      : `compacted ${summary.compactions} time${summary.compactions === 1 ? '' : 's'}`;
  return (
    `${n(summary.turns)} turns, peak ${n(summary.peak)} tokens, ${compactions}, ` +
    `and never under ${n(summary.floor)}.`
  );
}

export function renderSession(view: SessionView, colour: Palette, width = screenWidth()): string {
  const out: string[] = [];
  const summary = summarize(view.series);

  out.push('');
  out.push(`  ${colour.bold('context-tax session')}  ${colour.dim((view.series.firstSeen ?? '').slice(0, 10))}`);
  out.push('');

  if (summary.turns < 2) {
    out.push(`  ${colour.yellow('This session has too few turns to draw.')}`);
    out.push('');
    return out.join('\n');
  }

  const columns = Math.max(20, Math.min(120, width - AXIS - 4));
  const values = downsample(view.series.turns, columns);
  const scale = summary.peak;
  const floorRow = Math.max(0, Math.min(CHART_ROWS - 1, Math.floor((summary.floor / scale) * CHART_ROWS)));

  for (let row = CHART_ROWS - 1; row >= 0; row -= 1) {
    const label =
      row === CHART_ROWS - 1 ? short(scale) : row === floorRow ? short(summary.floor) : row === 0 ? '0' : '';
    let text = '';
    for (const value of values) {
      const filled = (value / scale) * CHART_ROWS - row;
      text += EIGHTHS[Math.max(0, Math.min(8, Math.round(filled * 8)))];
    }
    // Everything at or under the floor is the part of each turn that never goes away.
    const paint = row <= floorRow ? colour.yellow : colour.cyan;
    out.push(`  ${colour.dim(label.padStart(AXIS - 2))} ${colour.dim('│')}${paint(text)}`);
  }

  // Where the client compacted, under the turn it happened on.
  const marks = new Array<string>(values.length).fill(' ');
  for (const at of view.series.compactions) {
    marks[Math.min(values.length - 1, Math.floor((at * values.length) / view.series.turns.length))] = '▴';
  }
  out.push(`  ${' '.repeat(AXIS - 2)} ${colour.dim('└')}${colour.dim(marks.join('').replace(/ /g, '─'))}`);
  out.push('');

  const say = (text: string, paint: (part: string) => string): void => {
    for (const part of wrapClamped(text, width - 4, 4)) out.push(`  ${paint(part)}`);
  };
  say(sessionCaption(view), colour.bold);
  say(
    `▴ marks a compaction. The band at the bottom is what a compaction cannot remove: ${n(summary.floor)} tokens` +
      (view.openedAt === null
        ? ', sent again on every turn.'
        : `. The session opened at ${n(view.openedAt)}, before a word of work, and that is the part the main screen itemises.`),
    colour.dim,
  );
  out.push('');
  out.push(`  ${colour.dim('context-tax session --svg <file>   the same picture, to post')}`);
  out.push('');
  return out.join('\n');
}

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 630;
const PLOT = { left: 96, right: 1152, top: 150, bottom: 520 };
const SVG_POINTS = 600;

/** A self-contained image at the size a link preview wants. No font, script or file is referenced. */
export function renderSessionSvg(view: SessionView): string {
  const summary = summarize(view.series);
  const values = downsample(view.series.turns, SVG_POINTS);
  const scale = Math.max(1, summary.peak);
  const xAt = (index: number): number =>
    PLOT.left + (values.length <= 1 ? 0 : (index / (values.length - 1)) * (PLOT.right - PLOT.left));
  const yAt = (value: number): number => PLOT.bottom - (value / scale) * (PLOT.bottom - PLOT.top);
  const point = (index: number, value: number): string => `${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`;

  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${point(index, value)}`).join(' ');
  const area = `${line} L${PLOT.right},${PLOT.bottom} L${PLOT.left},${PLOT.bottom} Z`;
  const floorY = yAt(summary.floor);

  const compactionLines = view.series.compactions
    .map((at) => {
      const x = (PLOT.left + (at / Math.max(1, view.series.turns.length - 1)) * (PLOT.right - PLOT.left)).toFixed(1);
      return `<line x1="${x}" y1="${PLOT.top}" x2="${x}" y2="${PLOT.bottom}" stroke="#f5f5f4" stroke-opacity="0.18" stroke-dasharray="3 5"/>`;
    })
    .join('');

  const font = 'font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"';
  const compactions =
    summary.compactions === 0 ? 'never compacted' : `${n(summary.compactions)} compaction${summary.compactions === 1 ? '' : 's'}`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" role="img" aria-label="${sessionCaption(view)}">`,
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#0c0a09"/>`,
    `<text x="${PLOT.left}" y="72" fill="#fafaf9" font-size="34" font-weight="700" ${font}>One coding-agent session, turn by turn</text>`,
    `<text x="${PLOT.left}" y="112" fill="#a8a29e" font-size="22" ${font}>${n(summary.turns)} turns · peak ${n(summary.peak)} tokens · ${compactions}</text>`,
    // The band first, so the curve is drawn over it.
    `<rect x="${PLOT.left}" y="${floorY.toFixed(1)}" width="${PLOT.right - PLOT.left}" height="${(PLOT.bottom - floorY).toFixed(1)}" fill="#f59e0b" fill-opacity="0.22"/>`,
    compactionLines,
    `<path d="${area}" fill="#38bdf8" fill-opacity="0.16"/>`,
    `<path d="${line}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linejoin="round"/>`,
    `<line x1="${PLOT.left}" y1="${floorY.toFixed(1)}" x2="${PLOT.right}" y2="${floorY.toFixed(1)}" stroke="#f59e0b" stroke-width="2"/>`,
    `<line x1="${PLOT.left}" y1="${PLOT.bottom}" x2="${PLOT.right}" y2="${PLOT.bottom}" stroke="#57534e" stroke-width="1.5"/>`,
    `<text x="${PLOT.left - 12}" y="${PLOT.top + 8}" fill="#a8a29e" font-size="18" text-anchor="end" ${font}>${short(summary.peak)}</text>`,
    `<text x="${PLOT.left - 12}" y="${(floorY + 6).toFixed(1)}" fill="#f59e0b" font-size="18" text-anchor="end" ${font}>${short(summary.floor)}</text>`,
    `<text x="${PLOT.left - 12}" y="${PLOT.bottom + 6}" fill="#a8a29e" font-size="18" text-anchor="end" ${font}>0</text>`,
    `<text x="${PLOT.left}" y="568" fill="#f59e0b" font-size="22" ${font}>It never drops under ${n(summary.floor)}. That band is sent again on every turn.</text>`,
    `<text x="${PLOT.left}" y="602" fill="#78716c" font-size="18" ${font}>dashed lines: the client compacted · npx context-tax session</text>`,
    '</svg>',
    '',
  ].join('\n');
}
