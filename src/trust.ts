/**
 * Whether a directory's own `.mcp.json` servers may be started.
 *
 * 🚨 **This is a security boundary, and it is a separate module for the same reason `args.ts` is:**
 * `index.ts` dispatches at module scope, so a decision that lives there cannot be called from a
 * test. The rule below was wrong for a release and no test could have caught it, because there was
 * nothing importable to point a test at.
 *
 * Starting a project server runs whatever command that repo's `.mcp.json` names. Standing in the
 * directory is consent: your own session starts the same command at the start of every turn, so
 * measuring it adds no exposure. A flag is not consent, and the gap between the two is the whole
 * question this module answers.
 */

import { isAbsolute, relative, resolve } from 'node:path';

/** `child` is `parent`, or somewhere underneath it. */
export function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * May the servers declared by `--cwd`'s project be started?
 *
 * Only when the real working directory sits **inside the project those servers are declared for**.
 * That is the one arrangement where the session you are actually in loads the same `.mcp.json`:
 * pointing up at the repo root from `packages/web`, or down at `packages/web` from the root, both
 * resolve to the same project root, and both are already starting those servers every turn.
 *
 * 🚨 The rule this replaces asked a looser question — is either path inside the other — and the
 * downward half of it was a hole. Standing in `~/projects` and running `--cwd ./just-cloned` put
 * the target underneath the working directory, so it counted as the monorepo case and the clone's
 * `.mcp.json` was executed: `uvx some-package` from a repo that had been on the disk for thirty
 * seconds. No session of yours in `~/projects` ever loads that file. Anchoring on the project root
 * keeps the monorepo case working and closes that, because a nested checkout is its own project.
 *
 * `here` is injectable only so the test does not have to `chdir`, which is process-global and
 * makes concurrent test files flaky.
 */
export function trustsProjectServers(
  flagCwd: string | undefined,
  config: { cwd: string; repoRoot: string | null },
  here: string = process.cwd(),
): boolean {
  // No flag means the target *is* the working directory, whatever the resolver made of it.
  if (flagCwd === undefined) return true;
  // `repoRoot` is where `.mcp.json` was looked up; without a work tree the target directory is its
  // own project, and a sibling standing next to it is still outside.
  return isWithin(resolve(here), resolve(config.repoRoot ?? config.cwd));
}
