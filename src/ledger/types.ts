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

/**
 * Which body of session history a verdict's denominator was counted over.
 *
 * 🔑 **It is chosen to match the blast radius of the fix, never the convenience of the number.**
 * `claude mcp remove <name> -s user` takes a server out of every project on this machine, so it
 * may only be recommended on machine-wide silence. A server idle in this repo and busy in the one
 * next door is not dead, and calling it dead on a project-scoped count would be the worst mistake
 * this tool could make: it would hand you a command that breaks work you are still doing.
 *
 * `'project'` is the default and is left unsaid on screen, because a directory-scoped count is
 * what this tool has always meant. `'machine'` is always said out loud.
 */
export type EvidenceScope = 'project' | 'machine';

export type Verdict =
  /** Measured, and called. The denominator is still printed, because a reader should check it. */
  | { kind: 'earning-it'; calls: number; sessions: number; window: string; scope: EvidenceScope }
  /** Zero calls across a window we can defend. The only verdict that recommends removal. */
  | { kind: 'never-called'; sessions: number; window: string; scope: EvidenceScope }
  /**
   * Called, but so rarely that the standing cost dwarfs the use. The verdict a cost floor
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
      scope: EvidenceScope;
    }
  /**
   * Zero calls, but nothing on disk records when this arrived, so the count proves nothing.
   * Handed back to the reader rather than dressed up as a finding.
   */
  | { kind: 'never-called-age-unknown'; sessions: number; why: string; scope: EvidenceScope }
  /** Too few sessions since it was configured for silence to mean anything yet. */
  | { kind: 'too-new'; sessions: number; scope: EvidenceScope }
  /** It could not start. It costs nothing and it does nothing, which is its own finding. */
  | { kind: 'broken'; reason: string }
  /** We chose not to start it, so there is no cost to report. Not a judgement of the server. */
  | { kind: 'not-measured'; reason: string }
  /**
   * Configured, and the session this screen was read from sent nothing for it. It costs nothing
   * there, whatever a probe of it weighs, so it is never a finding and never a saving.
   */
  | { kind: 'not-sent'; reason: string }
  /** Real cost, no attributable usage. Memory files are read by the model, not called by it. */
  | { kind: 'not-attributable'; why: string };

/**
 * `client` is what Claude Code sends on its own account: its system prompt, its tool schemas, the
 * tool-name list and the session details. `hooks` is what your hooks add in front of the first turn.
 * Both exist only when a session recorded them; without a record they are part of `unattributed`.
 */
export type RowKind = 'mcp-server' | 'skills' | 'agents' | 'memory' | 'hooks' | 'client';

/** Which of the client's own blocks a `client` row is. */
export type ClientPart = 'tools' | 'system-prompt' | 'tool-list' | 'session-details';

export interface LedgerRow {
  label: string;
  kind: RowKind;
  /**
   * How many things the row stands for, when it stands for several: skills, agents, files, tools.
   * The label says it in words for the screen. This is the same number for anything that is not
   * the screen, so nothing has to read it back out of a sentence.
   */
  count?: number;
  /** Set on `client` rows only. */
  part?: ClientPart;
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
  /**
   * How the number was arrived at, when it did not come from starting the server here.
   *
   * A row measured from the bundled fallback table prints the same dash as a row that could not be
   * measured at all, and the two are not the same thing. `measure` has always said which; the main
   * screen did not, so the one command most people run was the one that explained the least.
   * `null` whenever the figure came from this machine, which needs no caveat.
   */
  basis: string | null;
  verdict: Verdict;
  /** How you would turn it off, in words. `fix` executes these. */
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
   * The same recommendation as data, for `fix` to execute.
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
  /** Median first-request context across the sessions in `window`. `null` if there are none. */
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

/**
 * The whole machine, not this directory.
 *
 * Two jobs. It supplies the denominator when this project has too little history to judge
 * anything, and it is the only place the tool can state the scale of what it is talking about:
 * a per-turn figure means very little until you know how many turns there have been.
 */
export interface MachineEvidence {
  /** Sessions a human started. Subagent transcripts are billed work but they are not sessions. */
  sessions: number;
  /** Every turn on the machine, subagents included, because every one of them was billed. */
  turns: number;
  /** Sum of `input + cache_creation + cache_read` over every turn on the machine. Exact. */
  contextTokens: number;
  /**
   * `/clear` and `/compact`, counted because they are the user's own record of hitting the wall
   * this tool is about. Unfiltered built-ins, which is why they are counted here and not joined
   * against the resolved skill set like every other slash command.
   */
  clears: number;
  compacts: number;
}

/**
 * Where the rows came from.
 *
 * 🔑 `record` means they were read from what one of your sessions actually sent, and the day says
 * which. `measured` means no session here recorded that, so they are weighed from your config the
 * way the client is understood to pack it. The screen always says which of the two it is showing.
 */
export type LedgerSource =
  | { kind: 'record'; day: string; client: string | null; asSent: boolean }
  | { kind: 'measured' };

/**
 * The one edit that costs tokens instead of recovering them, so `fix` only makes it when asked.
 *
 * Raising the listing budget sends every skill description again. It is the answer when the skills
 * that lost theirs are ones you want the model to reach for, and it is never applied by default.
 */
export interface ListingBudgetOffer {
  fraction: number;
  addsTokens: number;
  /** A dropped skill could not be sized, so the fraction may still leave one description out. */
  atLeast: boolean;
  settingsPath: string;
}

export interface Ledger {
  cwd: string;
  source: LedgerSource;
  /**
   * The context window, when a session proves it. `null` otherwise: a share of a guessed window is
   * a number this tool printed once and had to take back.
   */
  windowTokens: number | null;
  listingBudget: ListingBudgetOffer | null;
  /**
   * Skills the newest recorded session sent as a name with no description, of how many it listed.
   * `null` when none were, and when no session recorded its listing. The first finding says the
   * same thing in a sentence; this is the pair of numbers behind it, for the receipt and `--json`.
   */
  neverReceived: { dropped: number; listed: number } | null;
  /** Every finding's actions, merged. `fix` reads this and nothing else. */
  actions: FixAction[];
  reconciliation: Reconciliation;
  machine: MachineEvidence;
  rows: LedgerRow[];
  findings: Finding[];
  /** Tokens per turn that the findings would recover between them. */
  recoverable: number;
  /**
   * Was anything on this screen actually judged for use?
   *
   * 🚨 Zero findings has two causes and they are opposites: everything here is earning its place,
   * or nothing here could be judged at all. A fresh clone reaches the second and used to print the
   * first, which is the same false confidence the reach rule exists to stop, one line higher up
   * the screen.
   */
  judged: boolean;
  problems: { path: string; message: string }[];
}
