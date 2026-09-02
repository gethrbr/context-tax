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

export interface SessionEvidence {
  sessionId: string;
  file: string;
  /**
   * `'subagent'` for a transcript under `<session-id>/subagents/`. Its turns are billed like any
   * other, but it is not a session a human started — counting it as one inflates every per-session
   * number downstream.
   */
  kind: TranscriptKind;
  /** Working directory the session ran in. `null` when no record in the file carried one. */
  cwd: string | null;
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
  outputTokens: number;
  firstSeen: string | null;
  lastSeen: string | null;
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
  sessions: SessionEvidence[];
  projects: ProjectEvidence[];
}
