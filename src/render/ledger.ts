/**
 * The ledger. One screen, and the only screen most people will ever run.
 *
 * `per call` is the column that changes behaviour. A total makes people shrug, because every total
 * looks like the cost of doing business. Cost per use is the one that reads as a bill.
 *
 * 🔑 The `NOT MEASURABLE HERE` block near the bottom is deliberate and it is not padding. It marks
 * the exact edge of what logs can answer, and it is written as a limit rather than as a pitch,
 * because a tool that states its own boundary is more believable than one that claims not to have
 * one.
 *
 * Every line on this screen is wrapped to the window by `layout.ts`. The columns were always
 * aligned; it was the sentences under them that ran off the edge and wrapped back to column 0.
 */

import type { Finding, Ledger, LedgerRow, Verdict } from '../ledger/types.js';
import { PROVISIONAL_NOTE } from '../measure/tokens.js';
import type { Palette } from './color.js';
import { hangingText, screenWidth, shortPath, wrapClamped } from './layout.js';
import type { Cell, Column, Section } from './table.js';
import { renderTable } from './table.js';

const n = (value: number): string => value.toLocaleString('en-US');

/**
 * Compact form for the `per call` column, which spans six orders of magnitude.
 *
 * A per-turn cost multiplied by thirty thousand turns does not fit in a column, and widening the
 * column to fit the worst case wastes half the screen on the common one. `265M` also reads faster
 * than `264,780,544`, and at that size the exact digits are not what anybody is deciding on.
 */
function compact(value: number): string {
  if (value < 100_000) return n(value);
  if (value < 1_000_000) return `${Math.round(value / 1000)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

/**
 * The table's own columns. Only the label flexes: the numbers are the point of the screen, and a
 * number column that changes width between runs is a number column you cannot compare across them.
 */
const TOKENS = 8;
/** What sits behind the listing, unloaded. Its own column because it is paid at a different time. */
const DEFERRED = 9;
const SHARE = 6;
const CALLS = 6;
const PER_CALL = 9;
/**
 * The same six columns, narrowed, for a window that cannot hold them at full width. Dropping a
 * column instead would be worse: `deferred` is the number no other tool prints, and a screen that
 * silently loses it on a narrow terminal is a screen that tells two different stories.
 */
const NARROW = { tokens: 7, deferred: 8, share: 5, calls: 5, perCall: 8 };
/** Below this the full-width columns no longer leave a readable name column. */
const NARROW_BELOW = 76;

function columnsFor(width: number): Column[] {
  const narrow = width < NARROW_BELOW;
  const sizes = narrow
    ? NARROW
    : { tokens: TOKENS, deferred: DEFERRED, share: SHARE, calls: CALLS, perCall: PER_CALL };
  // Everything the label does not get: the five number columns with the two spaces and the bar
  // each one costs, the label's own padding and bar, the left indent, and the closing bar. Get
  // this wrong by three and the whole table hangs off the right-hand edge, which is the shape of
  // bug the border exists to make visible.
  const fixed = Object.values(sizes).reduce((sum, value) => sum + value + 3, 0) + 3 + 2 + 1;
  const label = Math.max(8, Math.min(24, width - fixed));
  return [
    { header: '', width: label, align: 'left' },
    { header: 'tokens', width: sizes.tokens, align: 'right' },
    { header: 'deferred', width: sizes.deferred, align: 'right' },
    { header: 'share', width: sizes.share, align: 'right' },
    { header: 'calls', width: sizes.calls, align: 'right' },
    { header: 'per call', width: sizes.perCall, align: 'right' },
  ];
}

/** The one-line reason a row got its verdict. Always carries its denominator. */
function verdictLine(verdict: Verdict): { text: string; loud: boolean } | null {
  switch (verdict.kind) {
    case 'earning-it':
      return null;
    case 'rarely-called':
      return {
        text:
          `${n(verdict.calls)} call${verdict.calls === 1 ? '' : 's'} in ${n(verdict.sessions)} sessions ` +
          `${verdict.window}: ${n(verdict.perCall)} tokens of standing cost for each one` +
          (verdict.window === 'on record' ? ', an upper bound since its age is unknown' : ''),
        loud: true,
      };
    case 'never-called':
      return {
        text: `never called: 0 calls in ${n(verdict.sessions)} sessions ${verdict.window}`,
        loud: true,
      };
    case 'never-called-age-unknown':
      return {
        text:
          `0 calls in ${n(verdict.sessions)} sessions on record, but ${verdict.why}, ` +
          'so this is not evidence that it is old',
        loud: false,
      };
    case 'too-new':
      return {
        text: `only ${n(verdict.sessions)} sessions since it was configured, too few to judge`,
        loud: false,
      };
    case 'broken':
      return { text: `cannot start: ${verdict.reason}`, loud: true };
    case 'not-measured':
      return { text: verdict.reason, loud: false };
    case 'not-attributable':
      return { text: verdict.why, loud: false };
  }
}

/**
 * One row, one line. The verdict that used to sit underneath now goes either to FINDINGS (the loud
 * ones, which have a recommendation attached) or to the note list under the table (the quiet ones,
 * which are facts about why a row has no number).
 */
function cellsFor(row: LedgerRow, colour: Palette): Cell[] {
  return [
    { text: row.label },
    row.tokens === null
      ? { text: '-', paint: colour.dim }
      : { text: n(row.tokens), paint: colour.bold },
    {
      text:
        row.loadedTokens === null || row.tokens === null
          ? '-'
          : `+${n(row.loadedTokens - row.tokens)}`,
      paint: colour.dim,
    },
    { text: row.share === null ? '-' : `${Math.round(row.share * 100)}%`, paint: colour.dim },
    { text: row.calls === null ? '-' : n(row.calls), paint: colour.dim },
    { text: row.perCall === null ? '-' : compact(row.perCall), paint: colour.dim },
  ];
}

function renderFinding(finding: Finding, index: number, colour: Palette, width: number): string[] {
  const out: string[] = [];
  const number = `${index + 1}. `;
  // The headline hangs under its own number rather than resetting to the margin, so a wrapped
  // finding still reads as one finding.
  wrapClamped(finding.headline, width - 4 - number.length, 3).forEach((part, at) => {
    out.push(`${'    '}${at === 0 ? colour.bold(number + part) : colour.bold(`${' '.repeat(number.length)}${part}`)}`);
  });
  for (const part of wrapClamped(finding.detail, width - 7, 4)) {
    out.push(`${'       '}${colour.dim(part)}`);
  }
  if (finding.fix !== null) {
    for (const part of wrapClamped(`fix: ${finding.fix}`, width - 7, 3)) {
      out.push(`${'       '}${colour.cyan(part)}`);
    }
  }
  return out;
}

export function renderLedger(ledger: Ledger, colour: Palette, width = screenWidth()): string {
  const out: string[] = [];
  const line = (text = ''): void => {
    out.push(text);
  };
  /** Prose: wrapped to the window, and every continuation line kept under its own indent. */
  const say = (
    text: string,
    indent: number,
    paint: (part: string) => string,
    max = 6,
  ): void => {
    for (const part of wrapClamped(text, width - indent, max)) line(' '.repeat(indent) + paint(part));
  };

  line();
  line(`  ${colour.bold('context-tax')}  ${colour.dim(shortPath(ledger.cwd, width - 15))}`);
  say(PROVISIONAL_NOTE, 2, colour.dim);
  say(
    'tokens: what every turn carries. deferred: the schemas behind it, paid when something loads them.',
    2,
    colour.dim,
  );

  /* ---------------------------------------------------------------------------------------- */

  const { reconciliation } = ledger;
  const columns = columnsFor(width);
  const servers = ledger.rows.filter((row) => row.kind === 'mcp-server');
  const files = ledger.rows.filter((row) => row.kind !== 'mcp-server');

  const totals: Section = [];
  if (!reconciliation.overAttributed && reconciliation.unattributed !== null) {
    totals.push([
      { text: 'unattributed' },
      { text: n(reconciliation.unattributed), paint: colour.bold },
      { text: '' },
      {
        text:
          reconciliation.total === null || reconciliation.total === 0
            ? '-'
            : `${Math.round((reconciliation.unattributed / reconciliation.total) * 100)}%`,
        paint: colour.dim,
      },
    ]);
  }
  if (reconciliation.total !== null) {
    totals.push([
      { text: 'EVERY TURN', paint: colour.bold },
      { text: n(reconciliation.total), paint: colour.bold },
      { text: '' },
      { text: '100%', paint: colour.dim },
    ]);
  }

  const sections: Section[] = [
    servers.map((row) => cellsFor(row, colour)),
    files.map((row) => cellsFor(row, colour)),
  ].filter((section) => section.length > 0);
  if (totals.length > 0) sections.push(totals);

  line();
  const header: Cell[] = [
    { text: servers.length > 0 ? 'MCP SERVERS' : 'CONTEXT', paint: colour.bold },
    ...columns.slice(1).map((column) => ({ text: column.header, paint: colour.dim })),
  ];
  for (const text of renderTable(columns, header, sections, colour, 2)) line(text);

  // The quiet verdicts: why a row has no number, or why its calls cannot be counted. The loud ones
  // are not repeated here, because each of them is a finding below with a recommendation attached.
  for (const row of ledger.rows) {
    const verdict = verdictLine(row.verdict);
    if (verdict === null || verdict.loud) continue;
    for (const part of hangingText(`${row.label}: ${verdict.text}`, width, 4, 2)) {
      line(colour.dim(part));
    }
  }

  if (reconciliation.overAttributed) {
    line();
    // \u{1F6A8} The contract says rows must never sum to more than what was billed. When they do,
    // the remainder is not printed as a negative number and it is not quietly absorbed.
    line(`  ${colour.red('ESTIMATOR DISAGREES WITH THE MEASUREMENT')}`);
    say(
      `rows total ${n(reconciliation.attributed)} tokens against a billed ${n(reconciliation.total ?? 0)}.`,
      4,
      colour.red,
    );
    say(
      'Two things cause this and they are not the same: the estimator over-counts, or your config' +
        ' grew after the last session in the window. Check whether you added a server since then.',
      4,
      colour.dim,
    );
  } else if (reconciliation.total === null) {
    line();
    say(
      'No session here recorded a cold start, so there is no exact total to reconcile against.' +
        ' The rows above stand on their own.',
      2,
      colour.yellow,
    );
  } else {
    say(
      `EVERY TURN is exact, from usage. Median cold start across your ${reconciliation.window}.`,
      4,
      colour.dim,
    );
  }

  /* ---------------------------------------------------------------------------------------- */

  if (ledger.findings.length > 0) {
    line();
    line(`  ${colour.bold('FINDINGS')}`);
    ledger.findings.forEach((finding, index) => {
      for (const text of renderFinding(finding, index, colour, width)) line(text);
    });
  }

  line();
  line(`  ${colour.bold('NOT MEASURABLE HERE')}`);
  // ⚠️ Only when there are some. The unknown case still earns the paragraph, because "part of
  // every turn" is a real caveat about a real file; zero does not, and this used to tell a machine
  // with no memory files at all that they were "0 tokens of every turn. This tool can tell you what
  // they cost." A caveat about the limits of measuring nothing reads as a tool that is broken.
  const memory = ledger.rows.find((row) => row.kind === 'memory');
  if (memory === undefined || memory.tokens === null || memory.tokens > 0) {
    say(
      `Your memory and instruction files are ${
        memory?.tokens === undefined || memory.tokens === null ? 'part of' : `${n(memory.tokens)} tokens of`
      } every turn. This tool can tell you what they cost. It cannot tell you which of the` +
        " instructions inside them your agent actually used. Nothing in a log can: that needs the" +
        " model's attention, not your history.",
      4,
      colour.dim,
    );
    line();
  }
  say(
    'MCP connectors attached to your claude.ai account are also real context and appear in no file' +
      ' on this machine. Run /context in a session to see them.',
    4,
    colour.dim,
  );

  if (ledger.problems.length > 0) {
    line();
    line(`  ${colour.bold('PROBLEMS')}`);
    for (const problem of ledger.problems) {
      say(problem.message, 4, colour.yellow);
      say(shortPath(problem.path, width - 6), 6, colour.dim, 2);
    }
  }

  line();
  if (ledger.recoverable > 0) {
    line(
      `  ${colour.bold(`${n(ledger.recoverable)} tokens per turn recoverable`)} ${colour.dim(
        'from the findings above.',
      )}`,
    );
  }
  line(`  ${colour.dim('context-tax measure   what each line weighs, and how')}`);
  line(`  ${colour.dim('context-tax config    what is loaded, and from where')}`);

  line();
  return out.join('\n');
}
