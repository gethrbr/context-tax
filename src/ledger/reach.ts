/**
 * Where a line item can be loaded at all, which is the ceiling on any denominator that judges it.
 *
 * `0.2.0` established the floor: a verdict's denominator must cover **everything its fix would
 * switch off**, because `claude mcp remove <name> -s user` is machine-wide and a silence counted
 * in one repo can never justify it. This file is the other half of the same rule.
 *
 * 🚨 **A denominator must not cover sessions in which the thing could never have been loaded.**
 * A `.mcp.json` server is loadable in exactly one project, so counting the machine's sessions
 * against it is not a wider window on the same question, it is a window on a different one.
 *
 * Without this, the most likely first run of the tool was also its worst. Measured against the
 * published `0.2.1` on 2026-09-07, in a directory that had never run Claude Code, against a
 * `.mcp.json` committed a year earlier, with a fabricated corpus whose every session belongs to
 * another directory:
 *
 * ```
 * everything costs 740 tokens every turn and has never been called
 * 0 calls in 12 sessions on this machine since it was configured.
 * ```
 *
 * It was in context for none of those 12 sessions, and the same run against a real corpus put
 * hundreds in that sentence. The window under the verdict was real, and it was a window on
 * something else.
 *
 * ⚠️ The default when provenance cannot be established is `'project'`, and the asymmetry is
 * deliberate rather than tidy: widening makes a claim, while refusing to widen makes none, because
 * a project without enough sessions falls through to *too few to judge*. Unknown has to fall on
 * the side that stays quiet.
 */

import type {
  ConfigSource,
  ItemScope,
  McpScope,
  ResolvedPlugin,
} from '../resolve/types.js';

/** Whether this item is in context everywhere on the machine, or only inside this project. */
export type Reach = 'machine' | 'project';

/**
 * A settings file either applies to every directory or to one of them, and what it switches on
 * inherits that.
 *
 * `managed` is an administrator's file, so it reaches further than the user's own, not less.
 */
function reachOfSettingsFile(path: string | null, sources: ConfigSource[]): Reach {
  if (path === null) return 'project';
  switch (sources.find((source) => source.path === path)?.kind) {
    case 'user':
    case 'user-local':
    case 'managed':
      return 'machine';
    default:
      return 'project';
  }
}

/**
 * A plugin's reach is the reach of the settings file that enabled it.
 *
 * The usual case is `~/.claude/settings.json`, which puts its skills and servers in every session
 * on the machine. A plugin switched on in a repo's own `.claude/settings.json` is in context
 * nowhere else, and its silence elsewhere is not evidence of anything.
 */
export function pluginReach(
  plugin: string | null,
  plugins: ResolvedPlugin[],
  sources: ConfigSource[],
): Reach {
  const found = plugins.find((entry) => entry.id === plugin);
  return reachOfSettingsFile(found?.enabledBy ?? null, sources);
}

/**
 * 🔑 `user` is the only server scope that is machine-wide.
 *
 * `claude-json-project` reads as a user-level file because it lives in `~/.claude.json`, but the
 * entry is filed under one project directory and Claude Code loads it in that directory only. It
 * is the scope `claude mcp add -s local` writes, and `-s local` is the opposite of `-s user`.
 */
export function serverReach(
  server: { scope: McpScope; plugin: string | null },
  plugins: ResolvedPlugin[],
  sources: ConfigSource[],
): Reach {
  switch (server.scope) {
    case 'user':
      return 'machine';
    case 'project-mcp-json':
    case 'claude-json-project':
      return 'project';
    case 'plugin':
      return pluginReach(server.plugin, plugins, sources);
  }
}

/** The same question for a skill: `~/.claude/skills` is everywhere, `.claude/skills` is here. */
export function skillReach(
  skill: { scope: ItemScope; plugin: string | null },
  plugins: ResolvedPlugin[],
  sources: ConfigSource[],
): Reach {
  switch (skill.scope) {
    case 'user':
      return 'machine';
    case 'project':
      return 'project';
    case 'plugin':
      return pluginReach(skill.plugin, plugins, sources);
  }
}
