/**
 * When a line item entered the config, and how many sessions have run since.
 *
 * 🚨 **This is the guard that keeps the tool from becoming the thing it replaced.** A server added
 * yesterday has zero calls, and reporting that as "never used" is the failure that would make every
 * finding a guess wearing a disclaimer. The denominator has to be *sessions since it was
 * configured*, and it has to be printed — `0 calls in 41 sessions since this server was added` is a
 * finding; `never used` is an accusation.
 *
 * ⚠️ **git, never mtime.** The plan originally said mtime. `git checkout` rewrites mtimes, so on a
 * fresh clone every server looks added today and the guard inverts: the tool goes quiet exactly
 * when it should speak, and loud on nothing. `git log -S` asks the only question that survives a
 * clone — which commit first introduced this string into this file.
 */

import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

// Type-only across the layer boundary: dating is config's job, counting needs evidence's shape,
// and neither pulls the other's code in at runtime.
import type { SessionEvidence } from '../evidence/types.js';
import type { ConfiguredSince } from './types.js';

const run = promisify(execFile);

/** Git, bounded. A hung `git` must never hang the tool, and a missing git is a normal machine. */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 5_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

/** The work tree containing `cwd`, or `null` when there is not one. */
export async function repoRootOf(cwd: string): Promise<string | null> {
  const out = await git(cwd, ['rev-parse', '--show-toplevel']);
  return out === null ? null : out.trim() || null;
}

/**
 * The first commit that introduced `needle` into `file`.
 *
 * `-S` counts occurrences rather than matching a diff line, so a reformat that moves the key
 * around does not read as an addition. `--reverse` then first line is the *introduction*, not the
 * latest touch — a server edited last week was not added last week.
 */
export async function configuredSince(
  file: string,
  needle: string,
): Promise<ConfiguredSince> {
  const cwd = dirname(file);
  const root = await repoRootOf(cwd);
  if (root === null) {
    return {
      known: false,
      reason: 'not in a git repository, so the date it was added cannot be recovered',
    };
  }
  const out = await git(root, [
    'log',
    '--reverse',
    '--format=%H%x09%cI',
    '-S',
    needle,
    '--',
    file,
  ]);
  if (out === null) return { known: false, reason: 'git log failed' };
  const first = out.split('\n').find((line) => line.includes('\t'));
  if (first === undefined) {
    return {
      known: false,
      reason: 'no commit in this repository introduces it — uncommitted, or added by another tool',
    };
  }
  const [commit, iso] = first.split('\t');
  return { known: true, iso, commit: commit.slice(0, 12), via: 'git' };
}

/**
 * Sessions that started at or after `since`.
 *
 * Subagent transcripts are excluded: they are billed work but not sessions a human started, and
 * counting them would inflate the denominator and make a genuinely unused server look more unused
 * than it is — an error in the direction that costs the tool its credibility.
 */
export function sessionsSince(sessions: SessionEvidence[], since: ConfiguredSince): number | null {
  if (!since.known) return null;
  const at = Date.parse(since.iso);
  if (Number.isNaN(at)) return null;
  return sessions.filter(
    (session) =>
      session.kind === 'session' &&
      session.firstSeen !== null &&
      Date.parse(session.firstSeen) >= at,
  ).length;
}
