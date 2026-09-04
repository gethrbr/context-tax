/**
 * The one rule in this package that decides whether somebody else's code runs.
 *
 * 🚨 Every case here is the same question asked from a different directory: *would the session I
 * am actually in already be starting this server?* When the answer is yes, measuring it costs
 * nothing that is not already being paid. When it is no, a flag is being used as consent, and the
 * fix command is not the only thing that has to refuse.
 *
 * The regression at the bottom is not hypothetical. It shipped in 0.2.0, and it was found by
 * pointing the tool at repositories cloned five minutes earlier: one of them declared
 * `uvx arxiv-mcp-server`, and the run tried to start it.
 */

import { describe, expect, it } from 'vitest';

import { isWithin, trustsProjectServers } from '../trust.js';

/** A directory inside a git work tree, which is what `resolveConfig` reports for a real repo. */
const inRepo = (cwd: string, repoRoot: string): { cwd: string; repoRoot: string | null } => ({ cwd, repoRoot });
/** A directory with no work tree above it: it is its own project, and nothing else is. */
const loose = (cwd: string): { cwd: string; repoRoot: string | null } => ({ cwd, repoRoot: null });

describe('starting the servers a directory declares in its own .mcp.json', () => {
  it('trusts the run with no --cwd at all, which is every ordinary run', () => {
    expect(trustsProjectServers(undefined, inRepo('/repo', '/repo'), '/repo')).toBe(true);
  });

  it('trusts --cwd pointing at the directory we are already standing in', () => {
    expect(trustsProjectServers('.', inRepo('/repo', '/repo'), '/repo')).toBe(true);
  });

  it('trusts the flag pointing up at the repo root from one of its packages', () => {
    expect(trustsProjectServers('../..', inRepo('/repo', '/repo'), '/repo/packages/web')).toBe(true);
  });

  it('trusts the flag pointing down at a package of the repo we are standing in', () => {
    // The `.mcp.json` was still read from the root, and the session in that root already starts it.
    expect(trustsProjectServers('packages/web', inRepo('/repo/packages/web', '/repo'), '/repo')).toBe(true);
  });

  it('🚨 refuses a checkout that merely sits underneath the working directory', () => {
    // `cd ~/projects && context-tax --cwd ./just-cloned`. The target is below us, which the rule
    // this replaces read as the monorepo case above — and so it ran the clone's server command.
    // No session in ~/projects loads that file, so nothing about standing here is consent.
    expect(trustsProjectServers('./just-cloned', inRepo('/projects/just-cloned', '/projects/just-cloned'), '/projects')).toBe(false);
  });

  it('refuses a directory somewhere else entirely', () => {
    expect(trustsProjectServers('/elsewhere', inRepo('/elsewhere', '/elsewhere'), '/repo')).toBe(false);
  });

  it('refuses a subdirectory that is its own project because there is no work tree', () => {
    expect(trustsProjectServers('./sub', loose('/scratch/sub'), '/scratch')).toBe(false);
  });

  it('trusts a subdirectory of the loose project we are standing in', () => {
    expect(trustsProjectServers('..', loose('/scratch'), '/scratch/sub')).toBe(true);
  });

  it('compares paths as paths, not as strings that happen to share a prefix', () => {
    expect(isWithin('/repo-two/src', '/repo')).toBe(false);
    expect(isWithin('/repo/src', '/repo')).toBe(true);
    expect(isWithin('/repo', '/repo')).toBe(true);
  });
});
