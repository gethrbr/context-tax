/**
 * The join. Cost times usage, per line item, with a verdict.
 *
 * The other three passes are each useful alone and none of them is the product. `resolve` knows
 * what is loaded, `measure` knows what it weighs, `evidence` knows what was called. Only together
 * can they say the sentence the whole tool exists to say: *you pay this every turn and you have
 * never used it.*
 *
 * 🔑 **The rule that keeps this from becoming the linter it replaced** is that no row may claim
 * something is dead weight without printing the denominator that claim rests on. A server added
 * yesterday with zero calls is not dead, it is new, and a tool that cannot tell those apart is
 * guessing with a confident voice. Every verdict below therefore carries its own evidence window,
 * and `neverCalled` is unreachable without one.
 */

import type { FixAction } from '../fix/types.js';

export type Verdict =
  /** Measured, and called. The denominator is still printed, because a reader should check it. */
  | { kind: 'earning-it'; calls: number; sessions: number; window: string }
  /** Zero calls across a window we can defend. The only verdict that recommends removal. */
  | { kind: 'never-called'; sessions: number; window: string }
  /**
   * Called, but so rarely that the standing cost dwarfs the use. The verdict the plan's cost floor
   * asks for: a server used once in 115 sessions is not earning its place just because it is not
   * at zero, and a rule that only looked for zero would miss the most expensive row on this
   * machine.
   */
  | {
      kind: 'rarely-called';
      calls: number;
      sessions: number;
      perCall: number;
      /**
       * `on record` means the denominator covers every session we can see, not every session since
       * this arrived, because nothing on disk records when it arrived. It makes the per-call figure
       * an upper bound, and the output says so rather than quietly presenting it as exact.
       */
      window: 'since it was configured' | 'on record';
    }
  /**
   * Zero calls, but nothing on disk records when this arrived, so the count proves nothing.
   * Handed back to the reader rather than dressed up as a finding.
   */
  | { kind: 'never-called-age-unknown'; sessions: number; why: string }
  /** Too few sessions since it was configured for silence to mean anything yet. */
  | { kind: 'too-new'; sessions: number }
  /** It could not start. It costs nothing and it does nothing, which is its own finding. */
  | { kind: 'broken'; reason: string }
  /** We chose not to start it, so there is no cost to report. Not a judgement of the server. */
  | { kind: 'not-measured'; reason: string }
  /** Real cost, no attributable usage. Memory files are read by the model, not called by it. */
  | { kind: 'not-attributable'; why: string };

export type RowKind = 'mcp-server' | 'skills' | 'agents' | 'memory';

export interface LedgerRow {
  label: string;
  kind: RowKind;
  /**
   * What this costs on **every turn**: for an MCP server, its resident half, because current
   * Claude Code defers tool schemas and loads them on demand. `null` only when the item could not
   * be measured, or was measured by a source that could not split it. Never `0` for unknown.
   */
  tokens: number | null;
  /**
   * The same row with every schema loaded, which is what it costs the moment something reaches for
   * one of its tools, and what it would cost per turn on a client that does not defer. `null` for
   * rows where the distinction does not apply: a skill's frontmatter is resident and its body is
   * not counted at all.
   */
  loadedTokens: number | null;
  /** Share of the exact measured total, `null` when either side is unknown. */
  share: number | null;
  calls: number | null;
  /**
   * Tokens paid for each actual use, and the column that changes behaviour.
   *
   * 🔑 It is `tokens x turns / calls`, **not** `tokens / calls`. The schema is re-sent on every
   * turn whether or not you call it, so the standing cost is the per-turn figure multiplied by
   * every turn you took. Dividing only the per-turn number would understate a rarely-used server
   * by three or four orders of magnitude, which is the difference between a shrug and a decision.
   */
  perCall: number | null;
  verdict: Verdict;
  /** How you would turn it off, in words. M5 executes these. */
  fix: string | null;
}

/**
 * A specific, actionable recommendation. Separate from the rows because the interesting fix is
 * often narrower than the row: not "drop this server" but "drop the four tools of it you have
 * never called", not "delete this skill" but "demote it to user-invocable-only".
 */
export interface Finding {
  headline: string;
  detail: string;
  /** Tokens per turn this would recover, when it can be said exactly. */
  saves: number | null;
  fix: string | null;
  /**
   * The same recommendation as data, for `--fix` to execute.
   *
   * 🔑 The prose and the actions are generated together, from the same branch, so the sentence a
   * reader confirms and the edit that lands cannot describe two different things. Empty when there
   * is no automatic lever — a broken server should be repaired, not silently switched off.
   */
  actions: FixAction[];
}

/**
 * The exact half of the ledger.
 *
 * `total` comes from `usage`, which is what the API billed, so it is not an estimate. The rows are
 * estimates from serialized bytes. Forcing the rows to sum to the exact total puts all of the
 * uncertainty in `unattributed` instead of smearing a `≈` across every number on the screen.
 */
export interface Reconciliation {
  /** Median cold-start context across the sessions in `window`. `null` if there are none. */
  total: number | null;
  window: string;
  sessions: number;
  attributed: number;
  /**
   * The remainder: the base system prompt, built-in tool schemas, and anything this tool cannot
   * see. A visible row, never a rounding adjustment.
   */
  unattributed: number | null;
  /**
   * 🚨 Rows summing to MORE than the billed total means the estimator is wrong, and the run says so
   * rather than printing a negative remainder. Two things can cause it, and the output names both:
   * an over-counting estimator, or a config that grew after the last session in the window.
   */
  overAttributed: boolean;
}

export interface Ledger {
  cwd: string;
  /** Every finding's actions, merged. `--fix` reads this and nothing else. */
  actions: FixAction[];
  reconciliation: Reconciliation;
  rows: LedgerRow[];
  findings: Finding[];
  /** Tokens per turn that the findings would recover between them. */
  recoverable: number;
  problems: { path: string; message: string }[];
}
