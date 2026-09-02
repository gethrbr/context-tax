/**
 * Which plugins are actually on, and where their files are.
 *
 * 🔑 **Installed is not enabled, and the gap is large.** This machine has `superpowers` installed
 * with 14 skills and absent from every `enabledPlugins` map, so a resolver that walked the plugin
 * cache would report 14 skills that reach no session. The registry below decides membership;
 * the directory only supplies the contents.
 *
 * The install path is READ, not derived. Plugins live under three different layouts here —
 * `plugins/cache/<marketplace>/<plugin>/<version>`, `plugins/marketplaces/<mp>/plugins/<plugin>`
 * and `plugins/<name>` — and `installed_plugins.json` records the answer for each.
 */

import { join } from 'node:path';

import { asRecord, asString, readJsonObject } from './read.js';
import type { EffectiveSettings } from './settings.js';
import type { Problem, ResolvedPlugin } from './types.js';

export function pluginRegistryPath(home: string): string {
  return join(home, '.claude', 'plugins', 'installed_plugins.json');
}

interface Installation {
  scope: string | null;
  projectPath: string | null;
  installPath: string;
  installedAt: string | null;
}

function installations(value: unknown): Installation[] {
  if (!Array.isArray(value)) return [];
  const out: Installation[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record === null) continue;
    const installPath = asString(record.installPath);
    if (installPath === null) continue;
    out.push({
      scope: asString(record.scope),
      projectPath: asString(record.projectPath),
      installPath,
      installedAt: asString(record.installedAt),
    });
  }
  return out;
}

/**
 * Pick the installation that applies to `cwd`.
 *
 * A plugin can be installed several times over — this machine has `feature-dev` at both user and
 * project scope pointing at different marketplaces. The one whose `projectPath` contains `cwd`
 * wins; failing that, the user-scoped copy; failing that, the first recorded. Ambiguity resolves
 * toward the more specific claim, the same direction the settings chain resolves in.
 */
function pick(entries: Installation[], cwd: string): Installation | null {
  const scoped = entries.find(
    (entry) => entry.projectPath !== null && (cwd === entry.projectPath || cwd.startsWith(`${entry.projectPath}/`)),
  );
  if (scoped !== undefined) return scoped;
  return entries.find((entry) => entry.scope === 'user') ?? entries[0] ?? null;
}

export async function resolvePlugins(
  cwd: string,
  home: string,
  settings: EffectiveSettings,
  problems: Problem[],
): Promise<ResolvedPlugin[]> {
  const registry = await readJsonObject(pluginRegistryPath(home), problems);
  const installed = registry === null ? null : asRecord(registry.plugins);

  const ids = new Set<string>([...settings.enabledPlugins.keys()]);
  if (installed !== null) for (const id of Object.keys(installed)) ids.add(id);

  const plugins: ResolvedPlugin[] = [];
  for (const id of [...ids].sort()) {
    const toggle = settings.enabledPlugins.get(id);
    const chosen = installed === null ? null : pick(installations(installed[id]), cwd);
    plugins.push({
      id,
      enabled: toggle?.enabled ?? false,
      enabledBy: toggle?.from ?? null,
      installPath: chosen?.installPath ?? null,
      scope: chosen?.scope ?? null,
      installedAt: chosen?.installedAt ?? null,
    });
  }
  return plugins;
}
