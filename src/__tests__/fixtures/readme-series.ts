/**
 * The invented session the README's picture is drawn from.
 *
 * 🔒 **Fabricated, like everything else under this directory.** A real session's series is a record
 * of how somebody worked: how long they went, when they ran out of room, how often. The picture in
 * the README is therefore generated from arithmetic and never from a transcript.
 *
 * No randomness either. The image is committed and a test holds it byte for byte against the
 * renderer, so the series has to come out the same on every machine and every run.
 *
 * The shape is the real one, which is the point of drawing it: context climbs, the client compacts,
 * and the drop lands on the prefix and no lower. Five climbs, four compactions, 640 turns, a peak of
 * 186,000, and a floor of 41,200 over a session that opened at 40,000.
 */

import type { SessionSeries } from '../../evidence/series.js';

const CLIMBS = [
  { turns: 150, from: 40_000, to: 168_000 },
  { turns: 130, from: 41_200, to: 186_000 },
  { turns: 120, from: 43_000, to: 152_000 },
  { turns: 140, from: 42_100, to: 176_000 },
  { turns: 100, from: 44_500, to: 120_000 },
];

export function readmeSeries(): SessionSeries {
  const turns: number[] = [];
  const compactions: number[] = [];
  for (const climb of CLIMBS) {
    if (turns.length > 0) compactions.push(turns.length);
    for (let at = 0; at < climb.turns; at += 1) {
      // Fast at first and slower as it fills, which is how a working session actually grows, with
      // a small fixed ripple so the line is not a ruler.
      const progress = (at / (climb.turns - 1)) ** 0.85;
      const ripple = ((at * 37) % 7) * 150;
      const value = Math.round((climb.from + (climb.to - climb.from) * progress + ripple) / 100) * 100;
      turns.push(Math.min(climb.to, Math.max(climb.from, value)));
    }
  }
  return { turns, compactions, firstSeen: '2026-09-01T09:00:00.000Z', lastSeen: '2026-09-01T18:30:00.000Z' };
}
