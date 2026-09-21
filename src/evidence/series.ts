/**
 * One session, turn by turn.
 *
 * The scan adds a session up. This reads a single transcript in order and keeps the shape: how much
 * context each reply carried, and where the client compacted. That shape is the thing a total
 * cannot show, which is that a long session is a sawtooth, and that the bottom of every tooth is
 * the same fixed prefix the ledger itemises.
 *
 * Same two rules as the scan: streamed a line at a time, and a line that will not parse is skipped
 * rather than thrown.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface SessionSeries {
  /** Context carried by each main-loop reply, in order. Exact: it is what was billed. */
  turns: number[];
  /** Index into `turns` of the first reply after each compaction. */
  compactions: number[];
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface SeriesSummary {
  turns: number;
  peak: number;
  /**
   * The least any reply after the first carried. It is what a compaction falls back to, and it is
   * never less than the prefix, because the prefix is re-sent whole on the turn after one.
   */
  floor: number;
  compactions: number;
}

const ASSISTANT_HINT = '"type":"assistant"';
const COMPACT_HINTS = ['"compact_boundary"', '"isCompactSummary":true'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function readSessionSeries(path: string): Promise<SessionSeries> {
  const series: SessionSeries = { turns: [], compactions: [], firstSeen: null, lastSeen: null };
  // One reply is written as several lines that repeat its `usage`. See the scan for what counting
  // them all did to every total in the tool.
  const billed = new Set<string>();
  let compactedSinceLastTurn = false;

  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    const isAssistant = line.includes(ASSISTANT_HINT);
    const isCompaction = !isAssistant && COMPACT_HINTS.some((hint) => line.includes(hint));
    if (!isAssistant && !isCompaction) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (record === null || record.isSidechain === true) continue;

    if (
      (record.type === 'system' && record.subtype === 'compact_boundary') ||
      record.isCompactSummary === true
    ) {
      // A compaction writes a boundary and then a summary. Both mean the same event.
      compactedSinceLastTurn = true;
      continue;
    }

    const message = record.type === 'assistant' ? asRecord(record.message) : null;
    const usage = message === null ? null : asRecord(message.usage);
    if (message === null || usage === null) continue;
    const id = typeof message.id === 'string' ? message.id : null;
    if (id !== null) {
      if (billed.has(id)) continue;
      billed.add(id);
    }
    const total =
      asNumber(usage.input_tokens) +
      asNumber(usage.cache_creation_input_tokens) +
      asNumber(usage.cache_read_input_tokens);
    if (total <= 0) continue;

    if (typeof record.timestamp === 'string') {
      series.firstSeen ??= record.timestamp;
      series.lastSeen = record.timestamp;
    }
    if (compactedSinceLastTurn && series.turns.length > 0) series.compactions.push(series.turns.length);
    compactedSinceLastTurn = false;
    series.turns.push(total);
  }

  return series;
}

export function summarize(series: SessionSeries): SeriesSummary {
  const { turns } = series;
  if (turns.length === 0) return { turns: 0, peak: 0, floor: 0, compactions: 0 };
  let peak = 0;
  for (const value of turns) peak = Math.max(peak, value);
  // The first reply can be a cache hit on a resumed session, or the smallest simply because nothing
  // has been said yet, so the floor is read from everything after it when there is anything after it.
  const after = turns.length > 1 ? turns.slice(1) : turns;
  let floor = after[0];
  for (const value of after) floor = Math.min(floor, value);
  return { turns: turns.length, peak, floor, compactions: series.compactions.length };
}

/** `columns` values, each the most any turn in its slice carried, so a spike is never averaged away. */
export function downsample(turns: number[], columns: number): number[] {
  if (turns.length <= columns) return [...turns];
  const out: number[] = [];
  for (let column = 0; column < columns; column += 1) {
    const from = Math.floor((column * turns.length) / columns);
    const to = Math.max(from + 1, Math.floor(((column + 1) * turns.length) / columns));
    let most = 0;
    for (let at = from; at < to; at += 1) most = Math.max(most, turns[at]);
    out.push(most);
  }
  return out;
}
