/**
 * `resolveConfig(cwd)` — what is loaded in this directory right now.
 *
 * Useful before any of the rest of the tool exists: nobody can currently answer *"what is in my
 * context in this repo"* without starting a session and running `/context`, and that only reports
 * the session you are already paying for.
 */

import { homedir } from 'node:os';

import { resolveAgents, resolveCommands, resolveSkills } from './items.js';
import { resolveMcpServers } from './mcp.js';
import { resolveMemory } from './memory.js';
import { resolvePlugins } from './plugins.js';
import { mergeSettings } from './settings.js';
import { configuredSince, repoRootOf } from './since.js';
import type { Problem, ResolveResult } from './types.js';

export interface ResolveOptions {
  /** Defaults to the process working directory. */
  cwd?: string;
  /**
   * Defaults to `os.homedir()`. Injectable so the tests can build a whole machine in a temp
   * directory instead of mutating `$HOME` — which `os.homedir()` only honours on POSIX, so an
   * env-var test would silently stop testing anything on Windows.
   */
  home?: string;
}

export async function resolveConfig(options: ResolveOptions = {}): Promise<ResolveResult> {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const problems: Problem[] = [];

  const repoRoot = await repoRootOf(cwd);
  // Config is anchored at the repo root when there is one — `.mcp.json` and `.claude/` live there,
  // not in whichever subdirectory the session happens to have started in.
  const projectRoot = repoRoot ?? cwd;

  const { settings, sources: settingsSources } = await mergeSettings(projectRoot, home, problems);
  const plugins = await resolvePlugins(cwd, home, settings, problems);
  const enabledPluginPaths = plugins
    .filter((plugin): plugin is typeof plugin & { installPath: string } =>
      plugin.enabled && plugin.installPath !== null,
    )
    .map((plugin) => ({ id: plugin.id, installPath: plugin.installPath }));

  const mcp = await resolveMcpServers(cwd, projectRoot, home, settings, plugins, problems);

  /**
   * Dating, and the three sources answer three different questions.
   *
   * 🚨 A plugin server must NOT be dated from git. Its `.mcp.json` sits inside the plugin's own
   * checkout, so `git log` answers *"when did the plugin's author add this server"*, which is
   * routinely months before the machine running this ever heard of the plugin. The date that
   * means anything is when YOU installed it, and the registry records exactly that.
   */
  for (const server of mcp.servers) {
    if (server.scope === 'project-mcp-json') {
      server.configuredSince = await configuredSince(server.path, `"${server.name}"`);
      continue;
    }
    if (server.scope === 'plugin') {
      const installedAt = plugins.find((plugin) => plugin.id === server.plugin)?.installedAt ?? null;
      server.configuredSince =
        installedAt === null
          ? { known: false, reason: 'the plugin registry records no install date' }
          : { known: true, iso: installedAt, commit: null, via: 'plugin-install' };
      continue;
    }
    server.configuredSince = {
      known: false,
      reason: 'declared in ~/.claude.json, which is not version controlled',
    };
  }

  const [skills, agents, commands, memory] = await Promise.all([
    resolveSkills(projectRoot, home, enabledPluginPaths, settings, problems),
    resolveAgents(projectRoot, home, enabledPluginPaths, problems),
    resolveCommands(projectRoot, home, enabledPluginPaths),
    resolveMemory(cwd, projectRoot, home),
  ]);

  return {
    config: {
      cwd,
      repoRoot,
      settingsTarget: settings.skillOverridesTarget,
      sources: [...settingsSources, ...mcp.sources],
      mcpServers: mcp.servers,
      skills,
      agents,
      commands,
      memory,
      plugins,
      problems,
    },
    launch: mcp.launch,
  };
}

export { configuredSince, repoRootOf, sessionsSince } from './since.js';
export { projectSlug } from './memory.js';
export { managedSettingsPath } from './settings.js';
export { parseFrontmatter, safeUrl, entryArgument } from './read.js';
export type {
  ConfigSource,
  ConfiguredSince,
  ItemScope,
  McpFixLever,
  McpLaunchSpec,
  McpScope,
  McpTransport,
  MemoryFile,
  Problem,
  ResolveResult,
  ResolvedAgent,
  ResolvedCommand,
  ResolvedConfig,
  ResolvedMcpServer,
  ResolvedPlugin,
  ResolvedSkill,
  SkillOverride,
} from './types.js';
