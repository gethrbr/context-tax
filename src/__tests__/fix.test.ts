/**
 * The only part of this tool that writes.
 *
 * Every test here is about restraint. A tool that reports a wrong number is a bad tool; a tool that
 * *writes* a wrong number into somebody's settings and calls it a fix is one they uninstall. So the
 * cases below are mostly about the edits that must NOT be produced: a `skillOverrides` entry for a
 * plugin skill, which would report success and change nothing; a whole-plugin switch when one of its
 * skills is in daily use; a machine-wide edit justified by one repo's evidence; and a rewrite of a
 * settings file that did not parse.
 *
 * Tests marked 🚨 pin a bug that was real in this package, not a hypothetical.
 */

import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { unifiedDiff } from '../fix/diff.js';
import { ApplyError, applyFixes, backupRoot, fixLogPath, lastFixUnder, planFixes } from '../fix/index.js';
import { detectIndent, editSettings, FixError } from '../fix/json.js';
import { palette } from '../render/color.js';
import { actionsAt, asksForLevel, changeName, levelOffers, namesByWeight } from '../fix/levels.js';
import type { LevelOffer } from '../fix/levels.js';
import { renderApplied, renderLevels, renderPlan } from '../render/fix.js';
import type { FixAction, FixPlan, SettingsAction } from '../fix/types.js';

function action(overrides: Partial<SettingsAction> = {}): SettingsAction {
  return {
    kind: 'disable-mcpjson-server',
    server: 'ghost',
    settingsPath: '/repo/.claude/settings.local.json',
    why: 'never called',
    saves: 1_000,
    ...overrides,
  } as SettingsAction;
}

/* ------------------------------------ shaping the file ------------------------------------ */

describe('editing a settings file somebody maintains by hand', () => {
  it('keeps the file’s own indentation rather than imposing two spaces', () => {
    const before = '{\n    "permissions": {\n        "allow": []\n    }\n}\n';
    const { after } = editSettings(before, [{ kind: 'disable-mcpjson-server', server: 'ghost' }]);
    expect(detectIndent(before)).toBe('    ');
    expect(after).toContain('\n    "disabledMcpjsonServers"');
    // The untouched half must come back byte-identical, or the diff stops being readable.
    expect(after).toContain('        "allow": []');
  });

  it('keeps tabs', () => {
    const before = '{\n\t"permissions": {}\n}\n';
    const { after } = editSettings(before, [{ kind: 'disable-plugin', plugin: 'p@m' }]);
    expect(after).toContain('\n\t"enabledPlugins"');
  });

  it('keeps a file that ends without a newline ending without one', () => {
    const before = '{\n  "a": 1\n}';
    const { after } = editSettings(before, [{ kind: 'disable-plugin', plugin: 'p@m' }]);
    expect(after.endsWith('}')).toBe(true);
    expect(after.endsWith('\n')).toBe(false);
  });

  it('creates the object from nothing when the file does not exist', () => {
    const { after } = editSettings(null, [
      { kind: 'skill-override', skill: 'dead', value: 'off' },
    ]);
    expect(JSON.parse(after)).toEqual({ skillOverrides: { dead: 'off' } });
  });

  /**
   * 🚨 A settings file that will not parse is almost always a half-finished hand edit. Replacing it
   * with a fresh object would lose that work, and this tool has no business touching it at all.
   */
  it('refuses to rewrite a file that does not parse', () => {
    expect(() => editSettings('{ "a": ', [{ kind: 'disable-plugin', plugin: 'p@m' }])).toThrow(FixError);
  });

  it('refuses when the key it needs is the wrong shape', () => {
    const before = '{\n  "disabledMcpjsonServers": "ghost"\n}\n';
    expect(() => editSettings(before, [{ kind: 'disable-mcpjson-server', server: 'x' }])).toThrow(
      /not an array/,
    );
  });

  it('reports an edit the file already contains as already true, not as applied', () => {
    const before = '{\n  "skillOverrides": {\n    "dead": "off"\n  }\n}\n';
    const result = editSettings(before, [{ kind: 'skill-override', skill: 'dead', value: 'off' }]);
    expect(result.applied).toHaveLength(0);
    expect(result.already).toHaveLength(1);
    expect(result.after).toBe(before);
  });

  /**
   * Leaving a name in both lists leaves the outcome resting on a precedence rule the reader has to
   * know. The point of showing a diff is that they should not have to.
   */
  it('drops a server from the approval list when it disables it', () => {
    const before = '{\n  "enabledMcpjsonServers": [\n    "ghost",\n    "keep"\n  ]\n}\n';
    const { after } = editSettings(before, [{ kind: 'disable-mcpjson-server', server: 'ghost' }]);
    expect(JSON.parse(after)).toEqual({
      enabledMcpjsonServers: ['keep'],
      disabledMcpjsonServers: ['ghost'],
    });
  });
});

/**
 * The one edit that adds to every turn: sending every skill description again.
 */
describe('raising the skill listing budget', () => {
  const raise = { kind: 'listing-budget', fraction: 0.03, adds: 14_872 } as const;

  it('writes the fraction, and nothing else in the file moves', () => {
    const before = '{\n  "model": "opus"\n}\n';
    const { after, applied } = editSettings(before, [raise]);
    expect(after).toBe('{\n  "model": "opus",\n  "skillListingBudgetFraction": 0.03\n}\n');
    expect(applied).toHaveLength(1);
  });

  it('🚨 never lowers a budget somebody already set higher', () => {
    const before = '{\n  "skillListingBudgetFraction": 0.05\n}\n';
    const result = editSettings(before, [raise]);
    expect(result.after).toBe(before);
    expect(result.already).toHaveLength(1);
  });

  it('counts what it adds apart from what the plan recovers', async () => {
    const plan = await planFixes(
      [
        action({ kind: 'disable-mcpjson-server', server: 'a', saves: 800 }),
        action({ ...raise, saves: 0 } as Partial<SettingsAction>),
      ],
      { readText: async () => null },
    );
    expect(plan.saves).toBe(800);
    expect(plan.adds).toBe(14_872);
  });

  it('says what it costs on the screen that asks for confirmation', async () => {
    const plan = await planFixes([action({ ...raise, saves: 0 } as Partial<SettingsAction>)], { readText: async () => null });
    const screen = renderPlan(plan, palette(false), 80);
    expect(screen).toContain('raise the skill listing budget to 0.03 of the window');
    expect(screen).toContain('14,872 tokens per turn added: the cost of sending every description.');
    for (const text of screen.split('\n')) expect(text.length).toBeLessThanOrEqual(80);
  });
});

/* ---------------------------------------- the diff ---------------------------------------- */

describe('the diff shown before writing', () => {
  it('has no hunks when nothing changed', () => {
    expect(unifiedDiff('a\nb\nc\n', 'a\nb\nc\n')).toEqual([]);
  });

  it('reports line numbers and counts that match the change', () => {
    const hunks = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.map((line) => `${line.kind}${line.text}`)).toEqual([' a', '-b', '+B', ' c']);
    expect(hunks[0].beforeCount).toBe(3);
    expect(hunks[0].afterCount).toBe(3);
    expect(hunks[0].beforeStart).toBe(1);
  });

  it('splits distant changes into separate hunks rather than one giant one', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 1\n', 'CHANGED\n').replace('line 38', 'ALSO');
    expect(unifiedDiff(before, after).length).toBe(2);
  });
});

/* --------------------------------------- planning ----------------------------------------- */

describe('planning', () => {
  const files = new Map<string, string>();
  const readText = async (path: string): Promise<string | null> => files.get(path) ?? null;

  it('groups every action for one file into one edit', async () => {
    files.clear();
    const plan = await planFixes(
      [
        action({ kind: 'disable-mcpjson-server', server: 'a', saves: 10 }),
        action({ kind: 'skill-override', skill: 'b', value: 'off', saves: 5 } as Partial<SettingsAction>),
      ],
      { readText },
    );
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].actions).toHaveLength(2);
    expect(plan.saves).toBe(15);
  });

  it('never puts a manual action in a file edit', async () => {
    files.clear();
    const manual: FixAction = { kind: 'manual', command: 'claude mcp remove x -s user', why: 'w' };
    const plan = await planFixes([manual], { readText });
    expect(plan.edits).toHaveLength(0);
    expect(plan.manual).toEqual([manual]);
  });

  /**
   * 🚨 The second-run case. Actions the file already satisfies must not produce an empty edit, and
   * must not be silently dropped either — the run has to be able to say *"already done"*.
   */
  it('produces no edit at all when everything is already applied', async () => {
    files.clear();
    files.set('/repo/.claude/settings.local.json', '{\n  "disabledMcpjsonServers": [\n    "ghost"\n  ]\n}\n');
    const plan = await planFixes([action()], { readText });
    expect(plan.edits).toHaveLength(0);
    expect(plan.alreadyApplied).toHaveLength(1);
    expect(plan.saves).toBe(0);
  });

  it('reports a file it could not parse instead of claiming its actions were done', async () => {
    files.clear();
    files.set('/repo/.claude/settings.local.json', '{ oops');
    const plan = await planFixes([action()], { readText });
    expect(plan.edits).toHaveLength(0);
    expect(plan.alreadyApplied).toHaveLength(0);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].message).toMatch(/not valid JSON/);
  });
});

/* ---------------------------------------- writing ----------------------------------------- */

describe('writing', () => {
  async function machine(): Promise<{ home: string; settings: string }> {
    const home = await mkdtemp(join(tmpdir(), 'context-tax-fix-'));
    const settings = join(home, 'repo', '.claude', 'settings.local.json');
    await mkdir(join(home, 'repo', '.claude'), { recursive: true });
    return { home, settings };
  }

  it('backs up what it replaces, and the backup is readable only by its owner', async () => {
    const { home, settings } = await machine();
    await writeFile(settings, '{\n  "permissions": {}\n}\n');
    const plan = await planFixes([action({ settingsPath: settings })]);

    const applied = await applyFixes(plan, { home, stamp: 'stamp' });
    expect(applied[0].created).toBe(false);
    expect(applied[0].backup).toBe(join(backupRoot(home), 'stamp', `${home.replace(/^\//, '').replace(/\//g, '-')}-repo-.claude-settings.local.json`));

    expect(await readFile(applied[0].backup as string, 'utf8')).toBe('{\n  "permissions": {}\n}\n');
    // 🔒 A settings file can carry an `env` block, and an `env` block can carry an API key. The
    // copy has to be as protected as the original or the backup is a leak.
    expect((await stat(applied[0].backup as string)).mode & 0o777).toBe(0o600);
    expect((await stat(join(backupRoot(home), 'stamp'))).mode & 0o777).toBe(0o700);

    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({
      permissions: {},
      disabledMcpjsonServers: ['ghost'],
    });
  });

  it('creates a missing settings file, and has nothing to back up', async () => {
    const { home, settings } = await machine();
    const plan = await planFixes([action({ settingsPath: settings })]);
    const applied = await applyFixes(plan, { home, stamp: 'stamp' });
    expect(applied[0]).toEqual({ path: settings, backup: null, created: true });
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({ disabledMcpjsonServers: ['ghost'] });
  });

  it('leaves no temporary file behind', async () => {
    const { home, settings } = await machine();
    await writeFile(settings, '{}\n');
    await applyFixes(await planFixes([action({ settingsPath: settings })]), { home, stamp: 'stamp' });
    await expect(stat(`${settings}.context-tax.tmp`)).rejects.toThrow();
  });

  /** Planning must be safe to run and throw away. `--dry-run` is only as good as this. */
  it('planning alone never touches the file', async () => {
    const { settings } = await machine();
    await writeFile(settings, '{}\n');
    await planFixes([action({ settingsPath: settings })]);
    expect(await readFile(settings, 'utf8')).toBe('{}\n');
  });

  /**
   * 🚨 A read-only `.claude/` was an uncaught EACCES with a stack trace, after the backup had
   * already been copied. The error has to say which file, why, in words, and what did land first.
   */
  it('a directory it cannot write into is a sentence, and the file before it is reported as written', async () => {
    if (process.getuid?.() === 0) return; // root can write anywhere, so there is nothing to refuse
    const { home, settings } = await machine();
    await writeFile(settings, '{\n  "permissions": {}\n}\n');
    const locked = join(home, 'locked', '.claude', 'settings.local.json');
    await mkdir(join(home, 'locked', '.claude'), { recursive: true });
    await writeFile(locked, '{}\n');
    await chmod(join(home, 'locked', '.claude'), 0o555);
    try {
      const plan = await planFixes([action({ settingsPath: settings }), action({ settingsPath: locked })]);
      let caught: unknown;
      try {
        await applyFixes(plan, { home, stamp: 'stamp' });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ApplyError);
      const failure = caught as ApplyError;
      expect(failure.message).toBe(`could not write ${locked}: permission denied`);
      expect(failure.path).toBe(locked);
      expect(failure.applied.map((file) => file.path)).toEqual([settings]);
      expect(failure.applied[0].backup).not.toBeNull();
      // The file it could not write is as it was, nothing of it was copied, and no temp file remains.
      expect(await readFile(locked, 'utf8')).toBe('{}\n');
      await expect(stat(join(backupRoot(home), 'stamp', `${home.replace(/^\//, '').replace(/\//g, '-')}-locked-.claude-settings.local.json`))).rejects.toThrow();
      await expect(stat(`${locked}.context-tax.tmp`)).rejects.toThrow();
      // The first file's backup is in the stamp directory, so the directory stays.
      expect((await stat(join(backupRoot(home), 'stamp'))).isDirectory()).toBe(true);
    } finally {
      await chmod(join(home, 'locked', '.claude'), 0o755);
    }
  });

  it('a target that is a directory fails at the rename, and takes its temp file with it', async () => {
    const { home, settings } = await machine();
    await mkdir(settings);
    const plan = await planFixes([action({ settingsPath: settings })]);
    await expect(applyFixes(plan, { home, stamp: 'stamp' })).rejects.toThrow(`could not write ${settings}: that is a directory`);
    await expect(stat(`${settings}.context-tax.tmp`)).rejects.toThrow();
  });

  it('leaves no empty backup directory behind when the only write failed', async () => {
    if (process.getuid?.() === 0) return;
    const { home, settings } = await machine();
    await writeFile(settings, '{}\n');
    await chmod(join(home, 'repo', '.claude'), 0o555);
    try {
      await expect(applyFixes(await planFixes([action({ settingsPath: settings })]), { home, stamp: 'stamp' })).rejects.toThrow('permission denied');
      await expect(stat(join(backupRoot(home), 'stamp'))).rejects.toThrow();
    } finally {
      await chmod(join(home, 'repo', '.claude'), 0o755);
    }
  });

  it('the backup is copied only once the new text is on disk beside the target', async () => {
    if (process.getuid?.() === 0) return;
    const { home } = await machine();
    // A missing parent whose own parent is read-only: mkdir fails before any temp file is written.
    const locked = join(home, 'locked', '.claude', 'settings.local.json');
    await mkdir(join(home, 'locked'));
    await chmod(join(home, 'locked'), 0o555);
    try {
      const plan = await planFixes([action({ settingsPath: locked })]);
      await expect(applyFixes(plan, { home, stamp: 'stamp' })).rejects.toThrow('permission denied');
      await expect(stat(join(backupRoot(home), 'stamp'))).rejects.toThrow();
    } finally {
      await chmod(join(home, 'locked'), 0o755);
    }
  });
});

/**
 * The last screen a `--fix` prints is the one that has to be true, because it is the only
 * instruction the reader has after the tool has changed their machine.
 */
describe('what it says once it has written', () => {
  const plain = palette(false);

  it('tells you how to undo an overwrite', () => {
    const screen = renderApplied([{ path: '/x/settings.json', backup: '/b/settings.json', created: false }], plain, 80);
    expect(screen).toContain('copying the backup back');
  });

  it('🚨 does not point at a backup of a file that did not exist', () => {
    // A first `--fix` usually creates the settings file it writes to, and nothing was backed up
    // because there was nothing to back up. "Copy the backup back" is then an instruction that
    // cannot be followed, printed at the moment the reader most needs it to be true.
    const screen = renderApplied([{ path: '/x/settings.json', backup: null, created: true }], plain, 80);
    expect(screen).not.toContain('copying the backup back');
    expect(screen).toContain('undoing this is deleting them');
  });
});

/**
 * A deny rule, the lever for Claude Code's own tools and its agents.
 */
describe('a deny rule', () => {
  it('lands in permissions.deny beside what the file already allows', () => {
    const before = '{\n  "permissions": {\n    "allow": [\n      "Bash(ls)"\n    ]\n  }\n}\n';
    const { after, applied } = editSettings(before, [
      { kind: 'deny', rule: 'Artifact' },
      { kind: 'deny', rule: 'Agent(kit:reviewer)' },
    ]);
    expect(applied).toHaveLength(2);
    expect(JSON.parse(after)).toEqual({ permissions: { allow: ['Bash(ls)'], deny: ['Artifact', 'Agent(kit:reviewer)'] } });
  });

  it('is already true when the rule is there, and the file does not move', () => {
    const before = '{\n  "permissions": {\n    "deny": [\n      "Artifact"\n    ]\n  }\n}\n';
    const result = editSettings(before, [{ kind: 'deny', rule: 'Artifact' }]);
    expect(result.already).toHaveLength(1);
    expect(result.after).toBe(before);
  });

  it('refuses a permissions block that is not an object rather than replacing it', () => {
    expect(() => editSettings('{"permissions": []}', [{ kind: 'deny', rule: 'Artifact' }])).toThrow(FixError);
  });

  it('says on the plan which tool or agent stops working', () => {
    const plain = palette(false);
    const text = renderPlan(
      {
        edits: [
          {
            path: '/repo/.claude/settings.local.json',
            before: null,
            after: '{}\n',
            actions: [
              action({ kind: 'deny', rule: 'Workflow', saves: 2_000 } as Partial<SettingsAction>),
              action({ kind: 'deny', rule: 'Agent(kit:reviewer)', saves: 100 } as Partial<SettingsAction>),
            ],
          },
        ],
        manual: [],
        alreadyApplied: [],
        saves: 2_100,
        adds: 0,
        problems: [],
      },
      plain,
      100,
    );
    expect(text).toContain("switch off Claude Code's Workflow tool");
    expect(text).toContain('switch off the kit:reviewer agent');
  });
});

/**
 * 🔑 The before-and-after line needs to know when `fix` last wrote here. A fix that only created
 * files leaves no backup, so the log is the record and the backups are the fallback.
 */
describe('when fix last wrote here', () => {
  async function machine(): Promise<{ home: string; settings: string }> {
    const home = await mkdtemp(join(tmpdir(), 'context-tax-log-'));
    const settings = join(home, 'repo', '.claude', 'settings.local.json');
    await mkdir(join(home, 'repo', '.claude'), { recursive: true });
    return { home, settings };
  }

  it('logs a fix that only created a file, and finds it again by the tree', async () => {
    const { home, settings } = await machine();
    const plan = await planFixes([action({ settingsPath: settings })]);
    await applyFixes(plan, { home, stamp: 'stamp', now: '2026-10-12T08:00:00.000Z' });
    expect(await lastFixUnder(join(home, 'repo'), home)).toBe('2026-10-12T08:00:00.000Z');
    // Another tree has no fix, and a path that only starts with the same letters is another tree.
    expect(await lastFixUnder(join(home, 'repo-two'), home)).toBeNull();
    expect((await stat(fixLogPath(home))).mode & 0o777).toBe(0o600);
  });

  it('falls back to a backup directory written before the log existed', async () => {
    const { home } = await machine();
    const stamp = join(backupRoot(home), '2026-10-12T08-46-03-060Z');
    await mkdir(stamp, { recursive: true });
    await writeFile(join(stamp, `${join(home, 'repo').replace(/^\//, '').replace(/\//g, '-')}-.claude-settings.local.json`), '{}');
    expect(await lastFixUnder(join(home, 'repo'), home)).toBe('2026-10-12T08:46:03.060Z');
    // A backup of another repo's settings is that repo's fix, not this one's.
    expect(await lastFixUnder(join(home, 'elsewhere'), home)).toBeNull();
    // 🚨 And `rep` is not `repo`: flattening makes `/` and `-` the same character, so a bare prefix
    // would hand this repo's fix to any sibling whose name starts the same way.
    expect(await lastFixUnder(join(home, 'rep'), home)).toBeNull();
    const sibling = join(backupRoot(home), '2026-10-13T08-00-00-000Z');
    await mkdir(sibling, { recursive: true });
    await writeFile(join(sibling, `${join(home, 'repo-two').replace(/^\//, '').replace(/\//g, '-')}-.claude-settings.local.json`), '{}');
    expect(await lastFixUnder(join(home, 'repo'), home)).toBe('2026-10-12T08:46:03.060Z');
  });

  it('takes the newest, and skips a torn line in the log', async () => {
    const { home } = await machine();
    const repo = join(home, 'repo');
    await mkdir(join(home, '.cache', 'context-tax'), { recursive: true });
    await writeFile(
      fixLogPath(home),
      [
        JSON.stringify({ at: '2026-10-01T00:00:00.000Z', files: [`${repo}/.claude/settings.local.json`] }),
        '{"at": "2026-10-',
        JSON.stringify({ at: '2026-10-09T00:00:00.000Z', files: [`${repo}/.claude/settings.local.json`] }),
      ].join('\n'),
    );
    expect(await lastFixUnder(repo, home)).toBe('2026-10-09T00:00:00.000Z');
  });
});

describe('how much to switch off', () => {
  const action = (rule: string, saves: number): FixAction => ({
    kind: 'deny',
    rule,
    settingsPath: '/p/.claude/settings.local.json',
    why: 'w',
    saves,
  });
  const ledger = {
    actions: [action('Agent(kit:reviewer)', 300)],
    levelActions: { lean: [action('Artifact', 13_000)], max: [action('ListAgents', 500)] },
  };

  /** 🚨 Each level carries the ones below it, and no level carries the ones above it. */
  it('adds each level to the one before it, and never the one after', () => {
    const rules = (level: 'safe' | 'lean' | 'max'): string[] => actionsAt(ledger, level).map(changeName);
    expect(rules('safe')).toEqual(['kit:reviewer']);
    expect(rules('lean')).toEqual(['kit:reviewer', 'Artifact']);
    expect(rules('max')).toEqual(['kit:reviewer', 'Artifact', 'ListAgents']);
  });

  it('names the heaviest change first', () => {
    expect(namesByWeight([action('Small', 500), action('Artifact', 13_000), action('Agent(kit:a)', 900)])).toEqual([
      'Artifact',
      'kit:a',
      'Small',
    ]);
  });

  const planOf = (actions: FixAction[]): FixPlan => ({
    edits: [{ path: '/p/.claude/settings.local.json', before: '{}', after: '{}', actions: actions.filter((one) => one.kind !== 'manual') }],
    manual: [],
    alreadyApplied: [],
    saves: actions.reduce((sum, one) => sum + (one.kind === 'manual' ? 0 : (one.saves ?? 0)), 0),
    adds: 0,
    problems: [],
  });

  it('offers each level by what it adds, and everything it recovers', () => {
    const offers = levelOffers({
      safe: planOf(actionsAt(ledger, 'safe')),
      lean: planOf(actionsAt(ledger, 'lean')),
      max: planOf(actionsAt(ledger, 'max')),
    });
    expect(offers).toEqual([
      { level: 'safe', changes: 1, saves: 300, adds: ['kit:reviewer'] },
      { level: 'lean', changes: 2, saves: 13_300, adds: ['Artifact'] },
      { level: 'max', changes: 3, saves: 13_800, adds: ['ListAgents'] },
    ]);
  });

  /** A change an earlier fix made is not in the plan, so it is not offered, and neither is its level. */
  it('drops a stronger level with nothing left to write, and keeps safe as the default', () => {
    const offers = levelOffers({ safe: planOf([]), lean: planOf([]), max: planOf([action('ListAgents', 500)]) });
    expect(offers.map((one) => one.level)).toEqual(['safe', 'max']);
    expect(offers[0]).toEqual({ level: 'safe', changes: 0, saves: 0, adds: [] });
  });

  /** 🚨 A question nobody can answer is a hang in CI, and one asked after --yes breaks a promise. */
  it('asks only a terminal that has not already picked, and only between two levels or more', () => {
    const quiet = { json: false, dryRun: false, yes: false };
    expect(asksForLevel(quiet, true, 3)).toBe(true);
    expect(asksForLevel(quiet, false, 3)).toBe(false);
    expect(asksForLevel({ ...quiet, level: 'safe' }, true, 3)).toBe(false);
    expect(asksForLevel({ ...quiet, yes: true }, true, 3)).toBe(false);
    expect(asksForLevel({ ...quiet, dryRun: true }, true, 3)).toBe(false);
    expect(asksForLevel({ ...quiet, json: true }, true, 3)).toBe(false);
    expect(asksForLevel(quiet, true, 1)).toBe(false);
  });

  const offers: LevelOffer[] = [
    { level: 'safe', changes: 1, saves: 300, adds: ['kit:reviewer'] },
    { level: 'lean', changes: 2, saves: 13_300, adds: ['Artifact'] },
    { level: 'max', changes: 3, saves: 13_800, adds: ['ListAgents'] },
  ];

  it('numbers the levels, mildest first, each with everything it would recover', () => {
    const menu = renderLevels(offers, palette(false), { asFlags: false }, 80);
    expect(menu).toMatch(/1 {2}safe +300 tokens {2}what you do not use/);
    expect(menu).toMatch(/2 {2}lean +13,300 tokens {2}also what you use in under 1 session in 20/);
    expect(menu).toMatch(/3 {2}max +13,800 tokens {2}also what you use in under 1 session in 5/);
    expect(menu).toContain('+ Artifact');
    expect(menu.indexOf('safe')).toBeLessThan(menu.indexOf('lean'));
    for (const text of menu.split('\n')) expect(text.length).toBeLessThanOrEqual(80);
  });

  it('lists only the levels above the one that ran, as the flags that run them', () => {
    const hint = renderLevels(offers, palette(false), { asFlags: true, above: 'lean' }, 80);
    expect(hint).toContain('--level max');
    expect(hint).not.toContain('--level lean');
    expect(hint).not.toContain('safe');
  });

  it('keeps a long list of names to two lines and counts the rest', () => {
    const many = Array.from({ length: 30 }, (_, index) => `agent-number-${index}`);
    const menu = renderLevels([{ level: 'safe', changes: 30, saves: 6_000, adds: many }], palette(false), { asFlags: false }, 80);
    const names = menu.split('\n').filter((text) => text.includes('agent-number'));
    expect(names).toHaveLength(2);
    expect(names[1]).toMatch(/and \d+ more$/);
  });

  it('says a level with nothing left to do has no change, not 0 tokens', () => {
    const menu = renderLevels(
      [{ level: 'safe', changes: 0, saves: 0, adds: [] }, offers[1]],
      palette(false),
      { asFlags: false },
      80,
    );
    expect(menu).toContain('no change');
    expect(menu).not.toContain(' 0 tokens');
  });
});
