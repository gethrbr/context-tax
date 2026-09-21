/**
 * What a scan of the local session history yields.
 *
 * This is the **evidence** half of the tool. It answers *"what did you actually use"* and nothing
 * else — it never reads config and never counts a token of cost. The cost half joins against it
 * later. Keeping them apart matters because they fail differently: evidence is exact and derived
 * from what the API billed, cost is estimated from schema bytes.
 */

import type { TranscriptKind } from './transcripts.js';

/** How a skill was reached. The distinction drives which `skillOverrides` state we recommend. */
export interface SkillUsage {
  /** The model chose it, via the `Skill` tool. Only these justify keeping a description in context. */
  model: number;
  /**
   * A human typed `/name`. These cost nothing to keep if the skill is set `user-invocable-only`,
   * because that state hides it from the model while leaving the slash command working.
   */
  user: number;
}

export interface McpServerUsage {
  calls: number;
  /** Distinct sessions that called it. A server used once in one session is not a used server. */
  sessions: number;
  /** Per-tool call counts, so a mostly-dead server with one hot tool is visible as such. */
  tools: Record<string, number>;
}

/** Cold-start context size, the closest thing the transcript has to a measured fixed prefix. */
export interface ColdStart {
  count: number;
  median: number;
  min: number;
  max: number;
}

/** One part of what a session sent, sized. */
export interface SentPart {
  chars: number;
  items: number;
}

/** One line of the skill listing, as the client sent it. 🔒 Never the description itself. */
export interface SentSkill {
  /** The name as the listing writes it: `plugin:name` for a plugin skill. */
  name: string;
  /** `false` when the line was the name alone, which is what the listing budget does to a skill. */
  described: boolean;
  /** The whole line. It is what lets a saving be computed for a skill that exists in no file. */
  chars: number;
}

export interface SentSkillListing {
  /** Characters of listing text the model was sent, framing included. */
  chars: number;
  /** The list on its own, which is what the client holds against its budget. */
  listChars: number;
  entries: number;
  /** Entries sent as a name with no description. */
  bare: number;
  /**
   * The lines themselves. `null` only where something downstream dropped them on purpose: the
   * `evidence --json` view does, because a machine with nine hundred sessions would otherwise
   * print two hundred thousand of these.
   */
  skills: SentSkill[] | null;
}

/** What one MCP server put in front of the model. Keyed by the name its tools are prefixed with. */
export interface SentServer {
  tools: number;
  /** Its tool names in the tool list. All a deferring client sends of a tool until it is loaded. */
  nameChars: number;
  instructionChars: number;
  /** Whole schemas, when the client loaded them up front rather than deferring. `0` otherwise. */
  schemaChars: number;
}

/**
 * What a session actually sent to the model, read from the transcript rather than modelled.
 *
 * 🔑 Claude Code writes each block it attaches to a conversation into the transcript as an
 * `attachment` line: the skill listing, the instruction files, the agent list, the tool names, each
 * server's instructions, and on a recent client the system prompt and its own tool schemas. That is
 * the prompt as it was sent, so a row read from it needs no model of how the client packs anything.
 *
 * ⚠️ The format is undocumented. Every field is optional, a part that is missing is `null`, and
 * nothing here throws on a shape it does not know. A `null` part sends its row back to the measure
 * pass, and the screen says which of the two a number came from.
 *
 * 🔒 Sizes, names and paths only. An `instructions` attachment holds the full text of every
 * CLAUDE.md, and a skill listing holds every description: both are measured and dropped inside the
 * parser, so neither can reach `Evidence`, `--json` or a renderer.
 */
export interface SentRecord {
  /** The Claude Code version that wrote it. */
  client: string | null;
  /**
   * `true` when sizes are of the text as sent. An older client records the parts without the
   * rendered text, and those are summed from the attachment's own fields, which leaves out the few
   * lines of framing around each one.
   */
  asSent: boolean;
  skillListing: SentSkillListing | null;
  /** `chars` is the block as sent. Each file's own size is kept so the largest can be named. */
  instructions: { chars: number; files: { path: string; chars: number }[] } | null;
  agents: SentPart | null;
  /** The tool-name list less what belongs to an MCP server: the client's own deferred tools. */
  toolList: SentPart | null;
  servers: Record<string, SentServer>;
  /** Servers the client could not connect. They sent nothing, whatever a probe of them weighs. */
  failedServers: string[];
  hooks: SentPart | null;
  /** Date, model, working directory, git status: small, fixed, and sent by the client itself. */
  sessionDetails: SentPart | null;
  systemPrompt: SentPart | null;
  /** The client's own tool schemas. `items` is how many tools. */
  builtinTools: SentPart | null;
}

export interface SessionEvidence {
  sessionId: string;
  file: string;
  /**
   * `'subagent'` for a transcript under `<session-id>/subagents/`. Its turns are billed like any
   * other, but it is not a session a human started — counting it as one inflates every per-session
   * number downstream.
   */
  kind: TranscriptKind;
  /**
   * Started by a script rather than a person: `claude -p` and the SDK. It is billed like any other
   * session, but it is often run with settings a person never uses, so it is the wrong session to
   * read "what your agent is sent" from while an interactive one exists.
   */
  headless: boolean;
  /** Working directory the session ran in. `null` when no record in the file carried one. */
  cwd: string | null;
  /** API replies that were billed. One reply is one turn, however many lines it was written as. */
  turns: number;
  /**
   * Turns belonging to a subagent rather than the main loop. Tracked separately because a subagent
   * carries a different prefix, so folding them into the median would bias it.
   */
  sidechainTurns: number;
  /**
   * The first request that read nothing from cache, so its total is the whole prompt: system
   * prompt, tools, memory files and the first user message. `null` if every request in the file
   * was a cache hit, which happens for resumed sessions.
   */
  coldStartTokens: number | null;
  /** Sum of `input + cache_creation + cache_read` over every turn. Exact: it is what was billed. */
  contextTokens: number;
  /**
   * The most one main-loop turn carried. Exact, and the only proof a transcript holds of how big
   * the context window was: a turn past the default window cannot have happened inside it.
   */
  peakContextTokens: number;
  outputTokens: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /**
   * What this session sent, where the transcript recorded it. `null` for a subagent, for a client
   * too old to write attachments, and for a session with none.
   */
  record: SentRecord | null;
}

export interface ProjectEvidence {
  cwd: string;
  sessions: number;
  turns: number;
  sidechainTurns: number;
  contextTokens: number;
  outputTokens: number;
  coldStart: ColdStart | null;
  firstSeen: string | null;
  lastSeen: string | null;
  mcpServers: Record<string, McpServerUsage>;
  builtinTools: Record<string, number>;
  /** Keyed by the `skill` argument the model passed to the `Skill` tool. */
  skills: Record<string, SkillUsage>;
  /** Keyed by `subagent_type`. */
  agents: Record<string, number>;
  /**
   * Every `/name` a human typed, **including built-in commands** like `/compact` and `/clear`.
   *
   * Deliberately unfiltered. A hardcoded list of built-ins would go stale the moment Claude Code
   * ships a new one, and a stale list silently misattributes a command to a skill that does not
   * exist. The join filters this against the resolved skill set instead, so the only names that
   * survive are ones a config actually declares.
   */
  slashCommands: Record<string, number>;
}

export interface Evidence {
  scannedFiles: number;
  /** Lines that would not parse. Counted rather than thrown, and surfaced so a corrupt corpus shows. */
  malformedLines: number;
  /**
   * Transcripts that could not be opened at all.
   *
   * 🚨 A corrupt line was always data rather than an exception; a corrupt *file* was not, and one
   * unreadable transcript took the whole run down with a Node stack trace. Both failures are
   * ordinary on a real machine: a file written by a `sudo` session is root-owned, a live session
   * can remove a file between the directory listing and the open, and a network home can drop a
   * read under load.
   *
   * They are collected rather than swallowed because every session inside them is missing from
   * every denominator on the screen, and an understated denominator is what makes a used server
   * look dead.
   */
  unreadable: string[];
  sessions: SessionEvidence[];
  projects: ProjectEvidence[];
}
