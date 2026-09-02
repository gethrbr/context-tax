/**
 * The command line.
 *
 * 🔑 The bug these were written against: `--help` printed the ledger. `parseArgs` skipped every
 * token starting with `-`, so the flag never became a command, the dispatch's `'--help'` branch
 * was unreachable, and typing the most common flag in any CLI started every MCP server in the
 * user's config and spent ten seconds measuring. The same hole swallowed typos, so `--refres` ran
 * a full measurement while looking like it had refreshed.
 *
 * Two levels, because the bug lived in the gap between them: the parser's contract as unit tests,
 * and one subprocess that proves the real binary honours it.
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { HELP, KNOWN_FLAGS, parseArgs } from '../args.js';

const run = promisify(execFile);
const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts');

describe('parseArgs', () => {
  it('defaults to the ledger with nothing on the line', () => {
    const args = parseArgs([]);
    expect(args.command).toBe('ledger');
    expect(args.usageErrors).toEqual([]);
    expect(args).toMatchObject({ json: false, color: true, top: 12, window: 10, spawn: true, timeoutMs: 10_000 });
  });

  // 🚨 The regression. Both spellings used to leave `command` at `'ledger'`.
  it.each(['--help', '-h'])('routes %s to the help command', (flag) => {
    expect(parseArgs([flag]).command).toBe('help');
  });

  it('lets --help win over a positional command, rather than measuring first', () => {
    expect(parseArgs(['measure', '--help']).command).toBe('help');
    expect(parseArgs(['--help', 'measure']).command).toBe('help');
  });

  it('lets --version win over a positional command too', () => {
    expect(parseArgs(['measure', '--version']).command).toBe('version');
    expect(parseArgs(['-v']).command).toBe('version');
  });

  it('names an unknown option instead of ignoring it', () => {
    const args = parseArgs(['--bogus']);
    expect(args.usageErrors).toEqual(['unknown option "--bogus".']);
  });

  // The typo that used to run a full measurement while looking like a refresh.
  it('catches a near miss on a real flag', () => {
    const args = parseArgs(['--refres']);
    expect(args.refresh).toBe(false);
    expect(args.usageErrors).toEqual(['unknown option "--refres".']);
  });

  it('collects every problem on the line, not just the first', () => {
    expect(parseArgs(['--bogus', '--nope']).usageErrors).toHaveLength(2);
  });

  it('reads the flags that carry values', () => {
    const args = parseArgs(['--cwd', '/tmp/x', '--top', '3', '--window', '25', '--timeout', '30']);
    expect(args).toMatchObject({ cwd: '/tmp/x', top: 3, window: 25, timeoutMs: 30_000 });
    expect(args.usageErrors).toEqual([]);
  });

  it.each(['--cwd', '--top', '--window', '--timeout'])('reports %s with no value', (flag) => {
    expect(parseArgs([flag]).usageErrors).toEqual([`${flag} needs a value.`]);
  });

  // A directory is never called `--json`, so this is a missing value and not a path.
  it('does not swallow the next flag as a value', () => {
    const args = parseArgs(['--cwd', '--json']);
    expect(args.cwd).toBeUndefined();
    expect(args.json).toBe(true);
    expect(args.usageErrors).toEqual(['--cwd needs a value.']);
  });

  /**
   * 🚨 The old `Number(raw) || default` answered `--top ten` with 12 and said nothing, so the
   * user read a number they had not asked for with no way to tell.
   */
  it.each([
    ['--top', 'ten'],
    ['--window', '0'],
    ['--timeout', '-5'],
  ])('refuses %s %s rather than falling back to the default', (flag, value) => {
    const args = parseArgs([flag, value]);
    expect(args.usageErrors).toEqual([`${flag} needs a positive number, not ${JSON.stringify(value)}.`]);
    expect(args).toMatchObject({ top: 12, window: 10, timeoutMs: 10_000 });
  });

  it('refuses two commands at once instead of silently running the first', () => {
    const args = parseArgs(['measure', 'fix']);
    expect(args.usageErrors).toEqual(['one command at a time, got "measure", "fix".']);
  });

  it('reads the boolean flags', () => {
    const args = parseArgs(['fix', '--json', '--no-color', '--no-spawn', '--refresh', '--dry-run', '-y']);
    expect(args).toMatchObject({
      command: 'fix',
      json: true,
      color: false,
      spawn: false,
      refresh: true,
      dryRun: true,
      yes: true,
    });
    expect(args.usageErrors).toEqual([]);
  });

  /**
   * 🔑 The structural half of the original bug: the help text never mentioned `--help`, so
   * reading it could not have revealed that the flag was missing. Neither list can now move
   * without the other.
   */
  it('documents every flag it accepts', () => {
    for (const flag of KNOWN_FLAGS) {
      expect(HELP, `${flag} is accepted but undocumented`).toMatch(new RegExp(`(?<![-\\w])${flag}(?![-\\w])`));
    }
  });

  it('accepts every flag its help text advertises', () => {
    const advertised = HELP.match(/(?<![-\w])--?[a-z][a-z-]*/g) ?? [];
    for (const flag of advertised) {
      expect(KNOWN_FLAGS, `${flag} is documented but not accepted`).toContain(flag);
    }
  });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** `--import tsx` runs the TypeScript entry point the way `dist/index.js` runs after a build. */
async function runCli(...argv: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', cli, ...argv]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

describe('the CLI, run for real', () => {
  /**
   * 🚨 The property that broke: asking for help must not start a measurement. A measurement is
   * the only thing here that prints the ledger's header, so its absence is the assertion. It is
   * also visible in the clock, since these two finish in milliseconds and the bug made each of
   * them spawn every configured MCP server and wait ten seconds.
   */
  it('prints help for --help without running anything', async () => {
    const { code, stdout } = await runCli('--help');
    expect(code).toBe(0);
    expect(stdout).toContain("context-tax: what your coding agent's context costs you every turn.");
    expect(stdout).toContain('--help, -h');
    expect(stdout).not.toContain('MCP SERVERS');
    expect(stdout).not.toContain('EVERY TURN');
  }, 30_000);

  it('exits non-zero and names an unknown option, without measuring', async () => {
    const { code, stdout, stderr } = await runCli('--refres');
    expect(code).toBe(1);
    expect(stderr).toContain('unknown option "--refres"');
    expect(stdout).not.toContain('MCP SERVERS');
  }, 30_000);

  /**
   * \u{1f6a8} A mistyped `--cwd` used to be the one bad input that bought a full report instead of an
   * exit code. Nothing project-scoped resolves under a path that is not there, so every such
   * server and skill came back with zero calls and the tool announced, of a directory that does
   * not exist, that ten skills were going unused. Found by running it; the parser could never
   * have caught it, because deciding this means touching the disk.
   */
  it('\u{1f6a8} refuses a --cwd that does not exist, instead of reporting on nothing', async () => {
    const { code, stdout, stderr } = await runCli('--cwd', '/no/such/place');
    expect(code).toBe(1);
    expect(stderr).toContain('does not exist');
    expect(stdout).not.toContain('FINDINGS');
    expect(stdout).not.toContain('never invoked');
  }, 30_000);

  it('refuses a --cwd that is a file, since a file has no config to resolve', async () => {
    const { code, stderr } = await runCli('--cwd', fileURLToPath(import.meta.url));
    expect(code).toBe(1);
    expect(stderr).toContain('is not a directory');
  }, 30_000);

  // The exemption has to survive the new check: asking what the flags are, with a bad one on the
  // line, is still better answered by the list than by a complaint about the path.
  it('still prints help when --help is asked for alongside an impossible --cwd', async () => {
    const { code, stdout } = await runCli('--cwd', '/no/such/place', '--help');
    expect(code).toBe(0);
    expect(stdout).toContain('--cwd <path>');
  }, 30_000);
});
