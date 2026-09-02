/**
 * The instruction files that ride along on every turn.
 *
 * ⚠️ **Not every `CLAUDE.md` in a repo is part of the fixed prefix.** A nested one is injected only
 * when a file under its directory is touched. Observed directly while building this package: this
 * repo's `packages/frontend/CLAUDE.md` entered context only after a frontend file was read, and
 * had never been there across the preceding turns. Folding nested files into the per-turn tax
 * would overstate it — for this repo, by every nested file at once.
 *
 * They are still discovered and reported, marked `alwaysLoaded: false`, because "you have eleven
 * more of these and they cost on the turns that touch them" is worth saying. It is just not the
 * same number.
 */

import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { MemoryFile } from './types.js';

/** Directories a walk should never enter. Cheap, and the difference between 40 ms and a minute. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.venv']);

/**
 * The transcript bucket for a directory: the path with every `/` replaced by `-`.
 *
 * Building the slug forward is deterministic. Reading it backwards is not — a directory whose own
 * name contains a dash is indistinguishable from a separator — which is why `evidence/` never
 * tries, and why this is the only place the mapping is used.
 */
export function projectSlug(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function walk(dir: string, root: string, depth: number, out: string[]): Promise<void> {
  if (depth > 4) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      await walk(join(dir, entry.name), root, depth + 1, out);
    } else if (entry.name === 'CLAUDE.md' && dir !== root) {
      out.push(join(dir, entry.name));
    }
  }
}

export async function resolveMemory(
  cwd: string,
  projectRoot: string,
  home: string,
): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];

  const push = async (path: string, kind: MemoryFile['kind'], alwaysLoaded: boolean): Promise<void> => {
    const bytes = await sizeOf(path);
    if (bytes === null) return;
    files.push({ path, kind, bytes, alwaysLoaded });
  };

  await push(join(home, '.claude', 'CLAUDE.md'), 'user', true);
  await push(join(projectRoot, 'CLAUDE.md'), 'project-root', true);

  // The chain between the repo root and the working directory is loaded too: those are the
  // directories the session is actually sitting in, not ones it might visit.
  if (cwd !== projectRoot && cwd.startsWith(`${projectRoot}/`)) {
    const parts = relative(projectRoot, cwd).split('/');
    let at = projectRoot;
    for (const part of parts) {
      at = join(at, part);
      await push(join(at, 'CLAUDE.md'), 'project-root', true);
    }
  }

  await push(
    join(home, '.claude', 'projects', projectSlug(projectRoot), 'memory', 'MEMORY.md'),
    'memory-index',
    true,
  );

  const nested: string[] = [];
  await walk(projectRoot, projectRoot, 0, nested);
  const already = new Set(files.map((file) => file.path));
  for (const path of nested.sort()) {
    if (already.has(path)) continue;
    await push(path, 'project-nested', false);
  }

  return files;
}
