/**
 * Editing a settings file somebody else maintains by hand.
 *
 * These files are not ours. A user wrote them, will read them again, and will diff them in a
 * review, so the edit has to look like one a person would have made: same indentation, same key
 * order, same trailing newline, one or two changed lines. `JSON.parse` then `JSON.stringify` with a
 * hardcoded two spaces would technically be correct and would reformat somebody's tab-indented file
 * from top to bottom — a diff that says *"this tool rewrote my config"* rather than *"this tool
 * disabled one server"*.
 *
 * 🚨 **A file that will not parse is never written.** Not repaired, not replaced with a fresh
 * object, not merged into. A malformed settings file usually means a half-finished hand edit, and
 * overwriting one loses work that this tool has no business touching.
 */

import type { FileAction } from './types.js';

export class FixError extends Error {}

/**
 * The file's own indentation, so the rewrite matches the hand that wrote it.
 *
 * Takes the first indented line rather than the most common one: nesting means deeper lines carry
 * multiples of the unit, and the first indented line is always exactly one unit in.
 */
export function detectIndent(text: string): string {
  const match = /\n([ \t]+)\S/.exec(text);
  if (match === null) return '  ';
  return match[1].includes('\t') ? '\t' : match[1];
}

interface Shape {
  [key: string]: unknown;
}

function objectAt(root: Shape, key: string): Shape {
  const existing = root[key];
  if (existing !== undefined && (typeof existing !== 'object' || existing === null || Array.isArray(existing))) {
    throw new FixError(`${key} is not an object`);
  }
  if (existing === undefined) root[key] = {};
  return root[key] as Shape;
}

function arrayAt(root: Shape, key: string): unknown[] {
  const existing = root[key];
  if (existing !== undefined && !Array.isArray(existing)) throw new FixError(`${key} is not an array`);
  if (existing === undefined) root[key] = [];
  return root[key] as unknown[];
}

/** `true` if the action changed something, `false` if the file already said this. */
function mutate(root: Shape, action: FileAction): boolean {
  switch (action.kind) {
    case 'disable-mcpjson-server': {
      const disabled = arrayAt(root, 'disabledMcpjsonServers');
      // ⚠️ Also drop it from the approval list, when it is there. Leaving a name in both lists
      // leaves the outcome resting on a precedence rule we do not control, and the whole point of
      // this edit is that the reader can see what it does without knowing that rule.
      const approved = Array.isArray(root.enabledMcpjsonServers) ? root.enabledMcpjsonServers : null;
      const wasApproved = approved !== null && approved.includes(action.server);
      if (wasApproved) {
        root.enabledMcpjsonServers = approved.filter((name) => name !== action.server);
      }
      if (disabled.includes(action.server)) return wasApproved;
      disabled.push(action.server);
      return true;
    }
    case 'disable-plugin': {
      const plugins = objectAt(root, 'enabledPlugins');
      if (plugins[action.plugin] === false) return false;
      plugins[action.plugin] = false;
      return true;
    }
    case 'skill-override': {
      const overrides = objectAt(root, 'skillOverrides');
      if (overrides[action.skill] === action.value) return false;
      overrides[action.skill] = action.value;
      return true;
    }
  }
}

export interface EditResult {
  after: string;
  applied: FileAction[];
  /** Already true on disk. A second run reports these rather than printing an empty plan. */
  already: FileAction[];
}

/**
 * Apply actions to the text of one settings file.
 *
 * `before` is `null` for a file that does not exist: `.claude/settings.local.json` is absent on a
 * clean checkout and creating it is the documented way to set an override, so absence is a normal
 * starting state rather than an error.
 */
export function editSettings(before: string | null, actions: FileAction[]): EditResult {
  let root: Shape;
  if (before === null || before.trim() === '') {
    root = {};
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(before);
    } catch (error) {
      throw new FixError(`it is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new FixError('its top level is not a JSON object');
    }
    root = parsed as Shape;
  }

  const applied: FileAction[] = [];
  const already: FileAction[] = [];
  for (const action of actions) {
    if (mutate(root, action)) applied.push(action);
    else already.push(action);
  }

  const indent = before === null ? '  ' : detectIndent(before);
  let after = JSON.stringify(root, null, indent);
  // Match the file's own line ending and trailing newline. A tool that flips either one turns a
  // one-line change into a whole-file diff.
  if (before !== null && before.includes('\r\n')) after = after.replace(/\n/g, '\r\n');
  if (before === null || /\r?\n$/.test(before)) after += before?.includes('\r\n') === true ? '\r\n' : '\n';

  return { after, applied, already };
}
