/**
 * Finding the session files.
 *
 * Claude Code writes one JSONL per session under `~/.claude/projects/<slug>/`, where the slug is
 * the working directory with every `/` replaced by `-`. That mapping is **lossy**: a directory
 * whose own name contains a dash is indistinguishable from a path separator, so the slug can never
 * be reversed into a path with confidence. We read the real `cwd` out of the records instead and
 * treat the slug as nothing more than a filesystem bucket.
 *
 * 🚨 **Subagent transcripts are NOT in the session file.** They are written to
 * `<slug>/<session-id>/subagents/*.jsonl`, one level deeper. A scan that reads only the top level
 * misses them entirely — on this machine that was 87 files of real, billed work — and, worse,
 * reports a confident `0 subagent turns` rather than an absence. The `isSidechain` field on a
 * record is not the signal either: it never appears as `true` anywhere in the corpus, because a
 * subagent's turns are never inlined into its parent. **The directory is the signal.**
 */

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/** A subagent's turns are billed like any other, but they are not a session a human started. */
export type TranscriptKind = 'session' | 'subagent';

export interface TranscriptFile {
  path: string;
  /** The directory name under `projects/`. A bucket key, never a path. See the note above. */
  slug: string;
  kind: TranscriptKind;
}

async function walk(dir: string, slug: string, depth: number, out: TranscriptFile[]): Promise<void> {
  // Session files sit at depth 0 and subagents at depth 2 (`<session-id>/subagents/`). The cap is
  // a guard against a symlink loop, not a statement about the layout.
  if (depth > 3) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, slug, depth + 1, out);
    } else if (entry.name.endsWith('.jsonl')) {
      out.push({ path, slug, kind: depth === 0 ? 'session' : 'subagent' });
    }
  }
}

/**
 * Every transcript under `projectsDir`, or `[]` if the directory is absent.
 *
 * `slugPrefix` narrows the search to the buckets that could hold sessions for one directory tree,
 * which takes the ledger's scan from the whole corpus to one project's share of it.
 *
 * 🔑 **It is sound only as a pre-filter, and only in one direction.** Every session whose `cwd` is
 * under a directory lands in a bucket whose slug starts with that directory's slug, so nothing
 * true is ever excluded. The reverse does not hold: the slug mapping is lossy, so a sibling
 * directory named `acme-notes` produces a bucket that matches the prefix for `acme`. Those
 * survive this filter and are dropped later by the real `cwd` read out of the records. Never use
 * this as the final filter.
 */
export async function findTranscripts(
  projectsDir: string,
  slugPrefix?: string,
): Promise<TranscriptFile[]> {
  let slugs: string[];
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    slugs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((slug) => slugPrefix === undefined || slug.startsWith(slugPrefix));
  } catch {
    return [];
  }

  const files: TranscriptFile[] = [];
  for (const slug of slugs) await walk(join(projectsDir, slug), slug, 0, files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
