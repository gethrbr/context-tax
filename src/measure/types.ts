/**
 * What a line item costs.
 *
 * The one rule this file exists to enforce: **`0` and "we could not find out" are different
 * answers, and only one of them is a number.** Tavily returned an empty body on `initialize`
 * during research; a measurer that wrote `0` there would have reported a paid-for server as free
 * dead weight and recommended keeping it. So every cost is `number | null`, and `null` always
 * arrives with a `status` that says why.
 */

/**
 * How a row's number was arrived at. Printed on every row, never inferred from the value.
 *
 * `estimated` is deliberately separate from `measured`: the `--no-spawn` fallback table is real
 * data, taken from real servers on a real machine, but it was taken on a *different day from a
 * different version*, and a row that cannot say so is a row that is quietly guessing.
 */
export type MeasureStatus =
  | { kind: 'measured'; at: string }
  | { kind: 'cached'; at: string }
  | { kind: 'estimated'; source: string }
  | { kind: 'unmeasured'; reason: string; cause: UnmeasuredCause };

/**
 * Why there is no number, and the two answers mean opposite things.
 *
 * `failed` is a finding: we asked and the server could not answer, so it is contributing nothing
 * to your sessions either. `declined` is an absence of evidence: we chose not to start it. The
 * ledger reaches a different verdict for each, so this is a field rather than something the join
 * infers by reading the reason string.
 */
export type UnmeasuredCause = 'failed' | 'declined';

export interface MeasuredTool {
  name: string;
  /** Serialized characters, see `serializeTool`. Per-tool because M4 joins this against calls. */
  chars: number;
  /**
   * Name plus description: what a deferred tool weighs while it sits in the listing, unloaded.
   * `null` only where the source cannot itemise tools, which today is the `--no-spawn` fallback
   * table's older rows. Never `0` standing in for unknown.
   */
  listingChars: number | null;
  /** Characters the server sent that the API request has no field for, see `unsentChars`. */
  unsent?: number;
}

export interface MeasuredMcpServer {
  name: string;
  status: MeasureStatus;
  /** `null` whenever `status.kind === 'unmeasured'`. Never `0` standing in for unknown. */
  toolCount: number | null;
  /**
   * Tool schemas **plus** the capped `instructions` blob: what this server weighs with every
   * schema loaded.
   *
   * 🔴 **This is not what a current Claude Code session pays per turn.** Measured 2026-09-02, the
   * client defers tool schemas and loads them on demand, so what a turn actually carries is
   * `residentChars` below. The loaded figure is still the right number for what a schema costs
   * when something does load it, and for any client that does not defer, which is why both are
   * kept rather than one being quietly replaced.
   */
  chars: number | null;
  tokens: number | null;
  /**
   * What every turn carries while the schemas are deferred: each tool's name and description, plus
   * the capped `instructions` blob. `null` when no source could itemise the tools.
   */
  residentChars: number | null;
  residentTokens: number | null;
  /**
   * Broken out of `chars` rather than folded into it, because it is the half nobody expects.
   * acme spends 4,374 characters here against 12,183 on schemas, so a quarter of its cost is a
   * block of prose, and a row that printed only a total would hide the cheapest thing to fix.
   *
   * This is the **counted** half: what the client shows the model, capped at `INSTRUCTIONS_CAP`.
   */
  instructionsChars: number | null;
  /**
   * What the server sent past the cap and the model therefore never saw. Carried for the same
   * reason as `unsentChars`: a server writing a 4,374-character manual is a fact about that
   * server, and a row that silently counted only half of it would look like a measurement error.
   */
  instructionsDroppedChars: number | null;
  /**
   * Characters the server sent that the Anthropic API has no slot for, mostly `annotations`.
   * Carried so the 16% assumption behind `chars` stays visible instead of being resolved silently.
   */
  unsentChars: number | null;
  /** What actually answered. Differs from the declared transport more often than you would think. */
  transportUsed: string | null;
  tools: MeasuredTool[];
}

/** Skills, agents and memory: counted from disk, so they are always measured. */
export interface MeasuredGroup {
  items: number;
  chars: number;
  tokens: number;
}

export interface MeasureResult {
  /**
   * Hosts contacted over the network to measure a remote server, and local commands started.
   * Printed, because "nothing leaves your machine" has to survive contact with an `http` MCP
   * server, and the way it survives is by naming exactly who was spoken to.
   */
  contacted: string[];
  spawned: string[];
  servers: MeasuredMcpServer[];
  skills: MeasuredGroup;
  agents: MeasuredGroup;
  memory: MeasuredGroup;
  /**
   * Sum of every row that has a number, with every schema loaded. Rows with `null` are counted in
   * `unmeasured` instead.
   */
  measuredTokens: number;
  /**
   * The same sum for what a turn actually carries while the client defers tool schemas. A server
   * whose tools could not be itemised is missing from this one and counted in `unsplit`, so the
   * two totals are not always over the same set of rows and the output has to say so.
   */
  residentTokens: number;
  unsplit: number;
  unmeasured: number;
  problems: { path: string; message: string }[];
}
