/**
 * Skills, agents and slash commands: the three things that get listed to the model by name.
 *
 * 🔑 **A skill is a directory holding a `SKILL.md` with frontmatter, not a markdown file.** On this
 * machine `~/.claude/skills` holds 30 bare `.md` notes beside 3 real skills, so counting files
 * would have reported 33 where the truth is 3 — and the plan's own §1 quotes "33+ registered"
 * because it was arrived at that way. Frontmatter is the membership test.
 *
 * 🔑 **Only the listing line is costed.** `name` and `description` enter the system prompt; the
 * body loads when the skill runs. Counting the body would be this tool's first lie and the most
 * tempting one, because it is the far bigger number.
 */

import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { parseFrontmatter } from './read.js';
import type { EffectiveSettings } from './settings.js';
import type { ItemScope, Problem, ResolvedAgent, ResolvedCommand, ResolvedSkill } from './types.js';

interface Root {
  dir: string;
  scope: ItemScope;
  plugin: string | null;
}

/** Roots in ascending precedence: a later entry of the same name shadows an earlier one. */
export function itemRoots(
  projectRoot: string,
  home: string,
  kind: 'skills' | 'agents' | 'commands',
  pluginPaths: { id: string; installPath: string }[],
): Root[] {
  return [
    { dir: join(home, '.claude', kind), scope: 'user', plugin: null },
    { dir: join(projectRoot, '.claude', kind), scope: 'project', plugin: null },
    ...pluginPaths.map((plugin) => ({
      dir: join(plugin.installPath, kind),
      scope: 'plugin' as const,
      plugin: plugin.id,
    })),
  ];
}

async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readText(path: string, problems: Problem[]): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    problems.push({ path, message: `could not read: ${(error as Error).message}` });
    return null;
  }
}

/**
 * Apply shadowing across scopes.
 *
 * Plugin items live in their own namespace — they are addressed `plugin:name` — so they never
 * shadow and are never shadowed. User and project share one namespace, and project wins: this
 * machine has `apple-design` in both, which a naive union would have counted twice.
 */
function markShadowed<T extends { name: string; scope: ItemScope; shadowedBy: ItemScope | null }>(
  items: T[],
): T[] {
  const winner = new Map<string, ItemScope>();
  for (const item of items) {
    if (item.scope === 'plugin') continue;
    if (item.scope === 'project') winner.set(item.name, 'project');
    else if (!winner.has(item.name)) winner.set(item.name, 'user');
  }
  for (const item of items) {
    if (item.scope === 'plugin') continue;
    const wins = winner.get(item.name);
    item.shadowedBy = wins !== undefined && wins !== item.scope ? wins : null;
  }
  return items;
}

export async function resolveSkills(
  projectRoot: string,
  home: string,
  pluginPaths: { id: string; installPath: string }[],
  settings: EffectiveSettings,
  problems: Problem[],
): Promise<ResolvedSkill[]> {
  const skills: ResolvedSkill[] = [];

  for (const root of itemRoots(projectRoot, home, 'skills', pluginPaths)) {
    for (const entry of await entriesOf(root.dir)) {
      // 🚨 **No dirent type check, deliberately.** `isDirectory()` is FALSE for a symlink, and five
      // of this machine's fourteen real skills are symlinks into `.agents/skills/` — they were
      // silently dropped, and the count came out 9 instead of 14 with no problem reported. Asking
      // the file system for `SKILL.md` follows the link and answers the only question that matters.
      // Same lesson as the subagent transcripts in `evidence/`: let the filesystem decide, not a
      // flag that means something narrower than it reads.
      const path = join(root.dir, entry.name, 'SKILL.md');
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        // A directory with no SKILL.md is not a skill. Silent: it is a normal thing to find.
        continue;
      }
      const frontmatter = parseFrontmatter(text);
      if (frontmatter === null) {
        problems.push({ path, message: 'SKILL.md has no frontmatter — not registered as a skill' });
        continue;
      }
      const name = frontmatter.fields.name ?? entry.name;
      const description = frontmatter.fields.description ?? '';
      skills.push({
        name,
        description,
        scope: root.scope,
        path,
        plugin: root.plugin,
        // `name: description`, which is the listing line. Approximate by construction and stated
        // as such — the exact rendering belongs to Claude Code, and §4.1 calibrates it against
        // `/context` rather than asserting it here.
        listingChars: name.length + 2 + description.length,
        shadowedBy: null,
        override: settings.skillOverrides.get(name)?.value ?? null,
      });
    }
  }

  return markShadowed(skills);
}

export async function resolveAgents(
  projectRoot: string,
  home: string,
  pluginPaths: { id: string; installPath: string }[],
  problems: Problem[],
): Promise<ResolvedAgent[]> {
  const agents: ResolvedAgent[] = [];

  for (const root of itemRoots(projectRoot, home, 'agents', pluginPaths)) {
    for (const entry of await entriesOf(root.dir)) {
      // `.md` and readable, not `isFile()` — a symlinked agent is still an agent. See the note in
      // `resolveSkills`.
      if (!entry.name.endsWith('.md')) continue;
      const path = join(root.dir, entry.name);
      const text = await readText(path, problems);
      if (text === null) continue;
      const frontmatter = parseFrontmatter(text);
      if (frontmatter === null) {
        problems.push({ path, message: 'agent file has no frontmatter — not registered' });
        continue;
      }
      const name = frontmatter.fields.name ?? basename(entry.name, '.md');
      const description = frontmatter.fields.description ?? '';
      const tools = frontmatter.fields.tools ?? null;
      agents.push({
        name,
        description,
        scope: root.scope,
        path,
        plugin: root.plugin,
        tools,
        // Agents are listed with their tool grant, so it is part of the line they cost.
        listingChars: name.length + 2 + description.length + (tools === null ? 0 : tools.length + 10),
        shadowedBy: null,
      });
    }
  }

  return markShadowed(agents);
}

/**
 * Slash commands. Discovered and sized, **not costed**.
 *
 * Whether a command's body, its description, or nothing at all reaches the system prompt is not
 * settled here, and the measurement contract says an unknown gets labelled rather than estimated.
 * `bytes` is the file on disk, which is a ceiling and is reported as one.
 */
export async function resolveCommands(
  projectRoot: string,
  home: string,
  pluginPaths: { id: string; installPath: string }[],
): Promise<ResolvedCommand[]> {
  const commands: ResolvedCommand[] = [];

  for (const root of itemRoots(projectRoot, home, 'commands', pluginPaths)) {
    for (const entry of await entriesOf(root.dir)) {
      if (!entry.name.endsWith('.md')) continue;
      const path = join(root.dir, entry.name);
      // A file we cannot stat is skipped rather than pushed with a zero. There is no
      // `bytes = 0` to fall back to on purpose: this package's whole contract is that an
      // unknown is labelled, never reported as a zero somebody would then act on.
      const stats = await stat(path).catch(() => null);
      if (stats === null) continue;
      commands.push({
        name: basename(entry.name, '.md'),
        scope: root.scope,
        path,
        plugin: root.plugin,
        bytes: stats.size,
      });
    }
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name));
}
