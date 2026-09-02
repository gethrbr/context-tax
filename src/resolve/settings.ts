/**
 * The settings chain.
 *
 * Claude Code reads several settings files and lets the more specific one win. The order below is
 * lowest precedence first, so a later entry overrides an earlier one — except for the two server
 * lists, which are unioned instead. See `mergeSettings` for why that asymmetry is deliberate.
 */

import { platform } from 'node:os';
import { join } from 'node:path';

import { asRecord, asStringArray, readJsonObject } from './read.js';
import type { ConfigSource, Problem, SkillOverride } from './types.js';

const SKILL_OVERRIDES: readonly SkillOverride[] = ['on', 'name-only', 'user-invocable-only', 'off'];

/**
 * Where an administrator's overrides live, per platform. Absent on almost every developer machine
 * — including this one — but it outranks everything else where it exists, so a tool that never
 * looks would report a config the machine does not have.
 */
export function managedSettingsPath(): string {
  switch (platform()) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode/managed-settings.json';
    case 'win32':
      return join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json');
    default:
      return '/etc/claude-code/managed-settings.json';
  }
}

/** The subset of settings that changes what is in context. Everything else is ignored on purpose. */
export interface EffectiveSettings {
  enableAllProjectMcpServers: boolean;
  /** `<plugin>@<marketplace>` -> on/off, and where the winning entry was written. */
  enabledPlugins: Map<string, { enabled: boolean; from: string }>;
  enabledMcpjsonServers: Set<string>;
  disabledMcpjsonServers: Set<string>;
  /** Skill name -> override, and the file that set it, which is where `--fix` writes. */
  skillOverrides: Map<string, { value: SkillOverride; from: string }>;
  /** Where a `--fix` should write a new `skillOverrides` entry. */
  skillOverridesTarget: string;
}

interface Layer {
  kind: ConfigSource['kind'];
  path: string;
}

/**
 * Lowest precedence first.
 *
 * ⚠️ `~/.claude/settings.local.json` sits between user and project on this machine and holds only
 * UI preferences today, but it is read anyway: a layer skipped because it *happens* to be empty is
 * a bug waiting for the day somebody writes to it.
 */
function layers(cwd: string, home: string): Layer[] {
  return [
    { kind: 'user', path: join(home, '.claude', 'settings.json') },
    { kind: 'user-local', path: join(home, '.claude', 'settings.local.json') },
    { kind: 'project-shared', path: join(cwd, '.claude', 'settings.json') },
    { kind: 'project-local', path: join(cwd, '.claude', 'settings.local.json') },
    { kind: 'managed', path: managedSettingsPath() },
  ];
}

function asSkillOverride(value: unknown): SkillOverride | null {
  return typeof value === 'string' && (SKILL_OVERRIDES as readonly string[]).includes(value)
    ? (value as SkillOverride)
    : null;
}

export interface MergedSettings {
  settings: EffectiveSettings;
  sources: ConfigSource[];
}

/**
 * Read and merge every settings layer for `cwd`.
 *
 * 🔑 **Scalars override, server lists union.** A `disabledMcpjsonServers` entry at any level
 * disables the server here, rather than being replaced by a higher layer's list. That is the
 * conservative direction and it is chosen on purpose: under-counting a server pushes its cost into
 * the visible `unattributed` row, while over-counting invents a row that can push the ledger past
 * the exact billed total — which §4 says must fail loudly. Erring toward the labelled remainder is
 * the only one of the two that stays honest on its own.
 */
export async function mergeSettings(
  cwd: string,
  home: string,
  problems: Problem[],
): Promise<MergedSettings> {
  const settings: EffectiveSettings = {
    enableAllProjectMcpServers: false,
    enabledPlugins: new Map(),
    enabledMcpjsonServers: new Set(),
    disabledMcpjsonServers: new Set(),
    skillOverrides: new Map(),
    // The `/skills` menu writes here, so a fix that wrote anywhere else would be invisible to it.
    skillOverridesTarget: join(cwd, '.claude', 'settings.local.json'),
  };
  const sources: ConfigSource[] = [];

  for (const layer of layers(cwd, home)) {
    const json = await readJsonObject(layer.path, problems);
    sources.push({
      kind: layer.kind,
      path: layer.path,
      present: json !== null,
      keys: json === null ? [] : Object.keys(json).sort(),
    });
    if (json === null) continue;

    if (typeof json.enableAllProjectMcpServers === 'boolean') {
      settings.enableAllProjectMcpServers = json.enableAllProjectMcpServers;
    }

    const plugins = asRecord(json.enabledPlugins);
    if (plugins !== null) {
      for (const [id, enabled] of Object.entries(plugins)) {
        if (typeof enabled === 'boolean') settings.enabledPlugins.set(id, { enabled, from: layer.path });
      }
    }

    for (const name of asStringArray(json.enabledMcpjsonServers)) settings.enabledMcpjsonServers.add(name);
    for (const name of asStringArray(json.disabledMcpjsonServers)) settings.disabledMcpjsonServers.add(name);

    const overrides = asRecord(json.skillOverrides);
    if (overrides !== null) {
      for (const [name, raw] of Object.entries(overrides)) {
        const value = asSkillOverride(raw);
        if (value === null) {
          problems.push({ path: layer.path, message: `skillOverrides.${name} is not one of ${SKILL_OVERRIDES.join('|')}` });
          continue;
        }
        settings.skillOverrides.set(name, { value, from: layer.path });
      }
    }
  }

  return { settings, sources };
}
