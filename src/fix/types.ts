/**
 * What `--fix` is allowed to do, as data.
 *
 * The ledger decides **what should change** — it is the only pass that has cost, usage and a
 * defensible window in one place. This module decides **how it is written**. Keeping those apart is
 * what stops the writer from re-deriving a judgement it does not have the evidence for, and it is
 * why `FixAction` carries no reasoning: by the time an action exists, the argument for it has
 * already been made and printed.
 *
 * 🚨 **Two kinds of action, and the split is a security boundary, not a convenience.**
 * `FileEdit` actions land in settings files this tool reads, backs up and rewrites atomically.
 * `manual` actions are handed back as a command for the human to run. The line between them is not
 * difficulty — it is `~/.claude.json`, which holds live API keys and bearer tokens. This tool will
 * not rewrite that file, and it will not back it up either, because a backup of it is a second
 * copy of every credential on the machine. A server declared there is reported, costed, and then
 * handed to `claude mcp remove`, which is the tool that owns the file.
 */

import type { SkillOverride } from '../resolve/types.js';

/** An edit to a settings JSON file we own. Every one of these is reversible from a backup. */
export type FileAction =
  | { kind: 'disable-mcpjson-server'; server: string }
  | { kind: 'disable-plugin'; plugin: string }
  | { kind: 'skill-override'; skill: string; value: SkillOverride };

/** A `FileAction` plus where it lands, why, and what it recovers. */
export type SettingsAction = FileAction & {
  settingsPath: string;
  why: string;
  /** Tokens per turn recovered, `null` when the item could not be measured. Never `0` for unknown. */
  saves: number | null;
};

/**
 * Not ours to write. Carries the exact command, because the point of routing is that the *right*
 * lever is named: `disabledMcpjsonServers` does nothing to a `~/.claude.json` server, and advice
 * that silently does nothing is worse than no advice.
 */
export interface ManualAction {
  kind: 'manual';
  /**
   * `null` when there is no command either — the item is real, the cost is real, and the only
   * lever would take working things with it. Saying that is the finding; inventing a command
   * would not be.
   */
  command: string | null;
  why: string;
}

export type FixAction = SettingsAction | ManualAction;

export function isFileAction(action: FixAction): action is SettingsAction {
  return action.kind !== 'manual';
}

/**
 * Identity of an action.
 *
 * Two things need it and they need the same answer: the ledger, to merge the several findings that
 * can arrive at one edit, and the planner, to match an applied action back to the one proposed.
 */
export function actionKey(action: FixAction): string {
  switch (action.kind) {
    case 'disable-mcpjson-server':
      return `server:${action.server}`;
    case 'disable-plugin':
      return `plugin:${action.plugin}`;
    case 'skill-override':
      return `skill:${action.skill}`;
    case 'manual':
      return `manual:${action.command ?? action.why}`;
  }
}

/** One settings file, its current text, and the text we propose. */
export interface FileEdit {
  path: string;
  /** `null` when the file does not exist yet and would be created. */
  before: string | null;
  after: string;
  actions: SettingsAction[];
}

export interface FixPlan {
  edits: FileEdit[];
  manual: ManualAction[];
  /**
   * Actions the ledger proposed that are already true on disk.
   *
   * Tracked rather than dropped so that a second `--fix` run says *"already done"* instead of
   * printing an empty plan that reads like a failure.
   */
  alreadyApplied: FixAction[];
  /** Tokens per turn the file edits would recover, when every one of them can be costed. */
  saves: number;
  /**
   * Files we refused to touch, and why.
   *
   * 🚨 A settings file that will not parse lands here rather than being rewritten from scratch or
   * quietly skipped. Its actions are reported as neither applied nor already-true, because they are
   * neither.
   */
  problems: { path: string; message: string }[];
}

export interface AppliedFile {
  path: string;
  /** Where the previous contents were copied. `null` when the file did not exist before. */
  backup: string | null;
  created: boolean;
}
