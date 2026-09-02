/**
 * Which MCP servers are loaded here, where each was declared, and how to turn it off.
 *
 * Four sources, four different levers. Getting the lever right is most of the value of `--fix`:
 * a server declared in `~/.claude.json` cannot be disabled from a settings file at all, so a tool
 * that emitted a `disabledMcpjsonServers` entry for it would print a fix that silently does
 * nothing — worse than printing none.
 *
 * 🚨 **This resolver can only see local config, and that is not everything in the session.** The
 * claude.ai connectors (Apollo.io, Gmail, Google Calendar, Google Drive) appear as `mcp__*` tools
 * in transcripts on this machine while appearing in **no local file** — they are attached to the
 * account, not the checkout. Apollo alone is ~70 tool schemas. The join must therefore treat a
 * server seen in evidence but absent from config as *account-level or since-removed*, never drop
 * it, and never report the resolved list as the whole context.
 */

import { join } from 'node:path';

import { asRecord, asString, asStringArray, entryArgument, keyNames, readJsonObject, safeUrl, stringMap } from './read.js';
import type { EffectiveSettings } from './settings.js';
import type {
  ConfigSource,
  McpFixLever,
  McpLaunchSpec,
  McpScope,
  McpTransport,
  Problem,
  ResolvedMcpServer,
  ResolvedPlugin,
} from './types.js';

export function claudeJsonPath(home: string): string {
  return join(home, '.claude.json');
}

function transportOf(definition: Record<string, unknown>): McpTransport {
  const declared = asString(definition.type);
  if (declared === 'http' || declared === 'sse' || declared === 'stdio') return declared;
  if (typeof definition.url === 'string') return 'http';
  if (typeof definition.command === 'string') return 'stdio';
  return 'unknown';
}

interface Candidate {
  name: string;
  definition: Record<string, unknown>;
  scope: McpScope;
  path: string;
  plugin: string | null;
}

/**
 * Pull `mcpServers` out of a file.
 *
 * ⚠️ **A `.mcp.json` with no `mcpServers` key is reported, not guessed at.** The `github` plugin
 * ships one whose server sits at the top level, unwrapped. Reading it anyway would invent a server
 * — and the evidence says Claude Code does not load it either: that plugin is enabled in this
 * repo and no `mcp__github__*` tool has ever appeared. So it becomes a problem with the file named,
 * which is the one form of this that helps.
 */
function serversFrom(
  json: Record<string, unknown> | null,
  path: string,
  scope: McpScope,
  plugin: string | null,
  problems: Problem[],
): Candidate[] {
  if (json === null) return [];
  const servers = asRecord(json.mcpServers);
  if (servers === null) {
    const looksLikeServers = Object.values(json).some(
      (value) => asRecord(value) !== null && ('command' in (value as object) || 'url' in (value as object)),
    );
    if (looksLikeServers) {
      problems.push({
        path,
        message: 'no "mcpServers" key, but top-level entries look like server definitions — not loaded',
      });
    }
    return [];
  }
  const out: Candidate[] = [];
  for (const [name, definition] of Object.entries(servers)) {
    const record = asRecord(definition);
    if (record === null) {
      problems.push({ path, message: `mcpServers.${name} is not an object` });
      continue;
    }
    out.push({ name, definition: record, scope, path, plugin });
  }
  return out;
}

/** Decide on/off and say why in a sentence the renderer can print unchanged. */
function decide(
  candidate: Candidate,
  settings: EffectiveSettings,
  plugins: ResolvedPlugin[],
): { enabled: boolean; reason: string; lever: McpFixLever } {
  const { name, scope } = candidate;

  if (scope === 'project-mcp-json') {
    if (settings.disabledMcpjsonServers.has(name)) {
      return {
        enabled: false,
        reason: 'listed in disabledMcpjsonServers',
        lever: { kind: 'none', why: 'already disabled' },
      };
    }
    const lever: McpFixLever = { kind: 'disabledMcpjsonServers', settingsPath: settings.skillOverridesTarget };
    if (settings.enableAllProjectMcpServers) {
      return { enabled: true, reason: 'enableAllProjectMcpServers is on', lever };
    }
    if (settings.enabledMcpjsonServers.has(name)) {
      return { enabled: true, reason: 'approved in enabledMcpjsonServers', lever };
    }
    // Not approved and not blanket-enabled. Claude Code prompts before loading it, so until
    // somebody answers that prompt the server costs nothing and must not appear as a live row.
    return {
      enabled: false,
      reason: 'not yet approved for this project',
      lever: { kind: 'none', why: 'not loaded' },
    };
  }

  if (scope === 'user') {
    return {
      enabled: true,
      reason: 'user scope, always loaded',
      // 🔑 Not settings-toggleable. The CLI is the only lever, and emitting a settings entry here
      // would be a fix that changes nothing.
      lever: {
        kind: 'claude-mcp-remove',
        command: `claude mcp remove ${name} -s user`,
        scope: 'user',
        path: candidate.path,
      },
    };
  }

  if (scope === 'claude-json-project') {
    return {
      enabled: true,
      reason: 'declared for this project in ~/.claude.json',
      // `local` is what Claude Code calls a server scoped to one project inside `~/.claude.json`.
      lever: {
        kind: 'claude-mcp-remove',
        command: `claude mcp remove ${name} -s local`,
        scope: 'local',
        path: candidate.path,
      },
    };
  }

  const plugin = plugins.find((entry) => entry.id === candidate.plugin);
  const enabled = plugin?.enabled ?? false;
  return {
    enabled,
    reason: enabled ? `provided by plugin ${candidate.plugin}` : `plugin ${candidate.plugin} is not enabled`,
    lever: enabled
      ? {
          kind: 'enabledPlugins',
          plugin: candidate.plugin ?? '',
          // 🚨 This project's settings file, NOT the one that enabled the plugin.
          //
          // A plugin is usually enabled machine-wide in `~/.claude/settings.json`, and writing the
          // `false` back there would turn *"you have not used this in this repo"* into *"switch it
          // off everywhere"* — a conclusion the evidence cannot support, because every count behind
          // it comes from sessions under this root. Provenance is not lost: `plugins[].enabledBy`
          // still records where the entry came from.
          settingsPath: settings.skillOverridesTarget,
        }
      : { kind: 'none', why: 'not loaded' },
  };
}

/**
 * Precedence when the same name is declared twice.
 *
 * ⚠️ **This order is an assumption, and the duplicate is reported rather than resolved silently.**
 * A second declaration is not a second server, so keeping both would double-count its cost and can
 * push the ledger past the exact billed total — which §4 of the plan says must fail loudly. One row
 * plus a named problem is the honest shape: the number stays defensible and the ambiguity stays
 * visible.
 */
const PRECEDENCE: McpScope[] = ['project-mcp-json', 'claude-json-project', 'plugin', 'user'];

export interface ResolvedMcp {
  servers: ResolvedMcpServer[];
  launch: Map<string, McpLaunchSpec>;
  sources: ConfigSource[];
}

export async function resolveMcpServers(
  cwd: string,
  projectRoot: string,
  home: string,
  settings: EffectiveSettings,
  plugins: ResolvedPlugin[],
  problems: Problem[],
): Promise<ResolvedMcp> {
  const sources: ConfigSource[] = [];
  const candidates: Candidate[] = [];

  const mcpJsonPath = join(projectRoot, '.mcp.json');
  const mcpJson = await readJsonObject(mcpJsonPath, problems);
  sources.push({
    kind: 'mcp-project',
    path: mcpJsonPath,
    present: mcpJson !== null,
    keys: mcpJson === null ? [] : Object.keys(mcpJson).sort(),
  });
  candidates.push(...serversFrom(mcpJson, mcpJsonPath, 'project-mcp-json', null, problems));

  const claudeJsonFile = claudeJsonPath(home);
  const claudeJson = await readJsonObject(claudeJsonFile, problems);
  sources.push({
    // Keys deliberately omitted: this file's top level is a large grab-bag of telemetry and its
    // `projects` map is keyed by every path this machine has ever opened. Neither is our business.
    kind: 'claude-json',
    path: claudeJsonFile,
    present: claudeJson !== null,
    keys: [],
  });
  candidates.push(...serversFrom(claudeJson, claudeJsonFile, 'user', null, problems));

  const projects = claudeJson === null ? null : asRecord(claudeJson.projects);
  const projectEntry = projects === null ? null : asRecord(projects[cwd] ?? projects[projectRoot]);
  if (projectEntry !== null) {
    candidates.push(
      ...serversFrom(projectEntry, claudeJsonFile, 'claude-json-project', null, problems),
    );
    // These are per-project approvals and they belong to the same union as the settings files'.
    for (const name of asStringArray(projectEntry.enabledMcpjsonServers)) settings.enabledMcpjsonServers.add(name);
    for (const name of asStringArray(projectEntry.disabledMcpjsonServers)) settings.disabledMcpjsonServers.add(name);
  }

  for (const plugin of plugins) {
    if (plugin.installPath === null) continue;
    const path = join(plugin.installPath, '.mcp.json');
    const json = await readJsonObject(path, problems);
    candidates.push(...serversFrom(json, path, 'plugin', plugin.id, problems));
  }

  const chosen = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = chosen.get(candidate.name);
    if (existing === undefined) {
      chosen.set(candidate.name, candidate);
      continue;
    }
    const winner =
      PRECEDENCE.indexOf(candidate.scope) < PRECEDENCE.indexOf(existing.scope) ? candidate : existing;
    const loser = winner === candidate ? existing : candidate;
    chosen.set(candidate.name, winner);
    problems.push({
      path: loser.path,
      message: `"${candidate.name}" is also declared in ${winner.path} (${winner.scope}), which wins — counted once`,
    });
  }

  const servers: ResolvedMcpServer[] = [];
  const launch = new Map<string, McpLaunchSpec>();

  for (const candidate of [...chosen.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const { definition } = candidate;
    const transport = transportOf(definition);
    const args = asStringArray(definition.args);
    const command = asString(definition.command);
    const rawUrl = asString(definition.url);
    const { enabled, reason, lever } = decide(candidate, settings, plugins);

    servers.push({
      name: candidate.name,
      transport,
      command,
      argCount: args.length,
      entry: entryArgument(args),
      envKeys: keyNames(definition.env),
      url: safeUrl(rawUrl),
      headerKeys: keyNames(definition.headers),
      scope: candidate.scope,
      path: candidate.path,
      plugin: candidate.plugin,
      enabled,
      enabledReason: reason,
      fixLever: lever,
      // Filled in by the caller, which is the only place that knows the repo and its history.
      configuredSince: { known: false, reason: 'not yet resolved' },
    });

    launch.set(candidate.name, {
      name: candidate.name,
      transport,
      command,
      args,
      env: stringMap(definition.env),
      url: rawUrl,
      headers: stringMap(definition.headers),
    });
  }

  return { servers, launch, sources };
}
