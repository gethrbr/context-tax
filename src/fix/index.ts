/**
 * Plan a set of edits, show them, then write them.
 *
 * Three properties this has to hold, and each one is a different failure it prevents:
 *
 *  1. **Planning never writes.** `planFixes` reads and returns; `applyFixes` is the only function
 *     that touches disk. That is what makes `--dry-run` trustworthy rather than a promise, and it
 *     is why the plan carries the full `after` text instead of a list of intentions.
 *  2. **Every write is reversible.** The previous contents go to `~/.cache/context-tax/backups/`
 *     before the new ones land, and the path is printed. A fix you cannot undo is a fix nobody
 *     should run on a config they have been tuning for a year.
 *  3. **Every write is atomic.** Temp file then `rename`, so an interrupted run leaves the old
 *     settings file intact rather than a half-written one. Claude Code reads these at startup, and
 *     a truncated settings file is a broken session, not a lost edit.
 */

import { chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { AppliedFile, FileAction, FileEdit, FixAction, FixPlan, ManualAction, SettingsAction } from './types.js';
import { editSettings, FixError } from './json.js';
import { actionKey, isFileAction } from './types.js';

/**
 * 🔒 Backups live under 0700 and each file lands 0600.
 *
 * A settings file may carry an `env` block, and an `env` block may carry an API key. Copying one
 * into a cache directory with default permissions would take a secret the user protected and put it
 * somewhere they are not thinking about. The copy inherits the protection, or it does not get made.
 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function backupRoot(home = homedir()): string {
  return join(home, '.cache', 'context-tax', 'backups');
}

/** `/Users/x/.claude/settings.local.json` -> `Users-x-.claude-settings.local.json`. */
function flatten(path: string): string {
  return path.replace(/^\/+/, '').replace(/[/\\]/g, '-');
}

export interface PlanOptions {
  /** Injectable for tests, which build a whole machine in a temp directory. */
  readText?: (path: string) => Promise<string | null>;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Group actions by the file they land in, and compute each file's new text.
 *
 * A file whose actions are all already true produces no edit at all. That is the second-run case,
 * and it has to read as *"already done"* rather than as an empty plan, so those actions are moved
 * to `alreadyApplied` instead of being dropped.
 */
export async function planFixes(actions: FixAction[], options: PlanOptions = {}): Promise<FixPlan> {
  const read = options.readText ?? readOrNull;
  const byFile = new Map<string, SettingsAction[]>();
  const manual: ManualAction[] = [];
  for (const action of actions) {
    if (!isFileAction(action)) {
      manual.push(action);
      continue;
    }
    const list = byFile.get(action.settingsPath) ?? [];
    list.push(action);
    byFile.set(action.settingsPath, list);
  }

  const edits: FileEdit[] = [];
  const alreadyApplied: FixAction[] = [];
  const problems: { path: string; message: string }[] = [];

  for (const [path, list] of byFile) {
    const before = await read(path);
    let result;
    try {
      result = editSettings(before, list);
    } catch (error) {
      // 🚨 An unparseable settings file is skipped, loudly. Its actions are not silently dropped
      // into `alreadyApplied`, which would claim they were done.
      problems.push({
        path,
        message: error instanceof FixError ? error.message : String(error),
      });
      continue;
    }
    const appliedKeys = new Set(result.applied.map(fileKey));
    for (const action of list) if (!appliedKeys.has(fileKey(action))) alreadyApplied.push(action);
    if (result.applied.length === 0) continue;
    edits.push({
      path,
      before,
      after: result.after,
      actions: list.filter((action) => appliedKeys.has(fileKey(action))),
    });
  }

  const saves = edits
    .flatMap((edit) => edit.actions)
    .reduce((sum, action) => sum + (action.saves ?? 0), 0);

  return { edits, manual, alreadyApplied, saves, problems };
}

/** `editSettings` returns bare `FileAction`s, which carry enough to be identified. */
function fileKey(action: FileAction): string {
  return actionKey({ ...action, settingsPath: '', why: '', saves: null });
}

export interface ApplyOptions {
  home?: string;
  /** A stable stamp for the backup directory name. Injectable so tests are deterministic. */
  stamp?: string;
}

/**
 * Write the plan. Confirmation happens in the CLI, above this line, on purpose: a function that
 * both asks and writes cannot be tested without a terminal.
 */
export async function applyFixes(plan: FixPlan, options: ApplyOptions = {}): Promise<AppliedFile[]> {
  const home = options.home ?? homedir();
  const stamp = options.stamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(backupRoot(home), stamp);
  const applied: AppliedFile[] = [];

  if (plan.edits.some((edit) => edit.before !== null)) {
    await mkdir(target, { recursive: true, mode: DIR_MODE });
    await chmod(target, DIR_MODE);
  }

  for (const edit of plan.edits) {
    let backup: string | null = null;
    if (edit.before !== null) {
      backup = join(target, flatten(edit.path));
      await copyFile(edit.path, backup);
      await chmod(backup, FILE_MODE);
    }
    await mkdir(dirname(edit.path), { recursive: true });
    // Temp file beside the target, then rename: same filesystem, so the rename is atomic and a
    // killed process cannot leave a settings file half written.
    const temp = `${edit.path}.context-tax.tmp`;
    await writeFile(temp, edit.after, { encoding: 'utf8', mode: FILE_MODE });
    await rename(temp, edit.path);
    applied.push({ path: edit.path, backup, created: edit.before === null });
  }

  return applied;
}

export { actionKey, isFileAction } from './types.js';
export { unifiedDiff } from './diff.js';
export { detectIndent, editSettings, FixError } from './json.js';
export type {
  AppliedFile,
  FileAction,
  FileEdit,
  FixAction,
  FixPlan,
  ManualAction,
  SettingsAction,
} from './types.js';
