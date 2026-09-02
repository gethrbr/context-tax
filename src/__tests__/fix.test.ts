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

import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { unifiedDiff } from '../fix/diff.js';
import { applyFixes, backupRoot, planFixes } from '../fix/index.js';
import { detectIndent, editSettings, FixError } from '../fix/json.js';
import type { FixAction, SettingsAction } from '../fix/types.js';

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
});
