/**
 * The config resolver, against a whole synthetic machine in a temp directory.
 *
 * `home` is injected rather than set through `$HOME`, because `os.homedir()` only consults that
 * variable on POSIX — an env-var test would quietly stop testing anything the day it ran on
 * Windows.
 *
 * Two of these tests exist because the first implementation got them wrong on real data and
 * reported a confident number rather than failing. They are marked 🚨.
 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { entryArgument, parseFrontmatter, resolveConfig, safeUrl, sessionsSince } from '../resolve/index.js';
import type { SessionEvidence } from '../evidence/types.js';

let root: string;
let home: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'context-tax-resolve-'));
  home = join(root, 'home');
  repo = join(root, 'repo');
  await mkdir(join(home, '.claude'), { recursive: true });
  await mkdir(join(repo, '.claude'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const write = async (path: string, body: unknown): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8');
};

const skill = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nA long body that must never be counted.\n`;

const resolve = () => resolveConfig({ cwd: repo, home });

/* ------------------------------------------------------------------------------------------- */

describe('parseFrontmatter', () => {
  it('reads key: value pairs and folds a wrapped description', () => {
    const parsed = parseFrontmatter('---\nname: a\ndescription: one\n  two\n---\nbody\n');
    expect(parsed?.fields.name).toBe('a');
    expect(parsed?.fields.description).toBe('one two');
  });

  it('returns null for a file with no frontmatter', () => {
    expect(parseFrontmatter('## Just a note\n- a bullet\n')).toBeNull();
  });

  it('returns null when the leading --- is a horizontal rule, not a fence', () => {
    expect(parseFrontmatter('--- not a fence\nbody\n---\n')).toBeNull();
  });
});

describe('safeUrl', () => {
  it('drops the query string, where a token is routinely parked', () => {
    expect(safeUrl('https://host/mcp?token=sk-secret')).toBe('https://host/mcp');
  });

  it('drops userinfo', () => {
    expect(safeUrl('https://user:sk-secret@host/mcp')).toBe('https://host/mcp');
  });

  it('returns null rather than the raw string when it cannot parse', () => {
    // An unparseable URL is exactly the shape most likely to be carrying something odd.
    expect(safeUrl('not a url')).toBeNull();
  });
});

describe('entryArgument', () => {
  it('skips valueless flags to reach the package', () => {
    expect(entryArgument(['-y', '@playwright/mcp@latest'])).toBe('@playwright/mcp@latest');
  });

  it('stops at a flag that takes a value, because the next argument is where a key lives', () => {
    expect(entryArgument(['--api-key', 'sk-secret', 'pkg'])).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('credentials', () => {
  /**
   * 🔒 The whole security posture in one test. `--json` exists, people paste its output into
   * issues, and `~/.claude.json` holds live API keys and bearer tokens.
   */
  it('never carries a secret into the printable config, from env, headers or a URL', async () => {
    await write(join(home, '.claude.json'), {
      mcpServers: {
        keyed: { command: 'npx', args: ['pkg'], env: { SERVICE_API_KEY: 'tok_SECRET_VALUE' } },
        bearer: { type: 'http', url: 'https://host/mcp?t=QUERY_SECRET', headers: { Authorization: 'Bearer HEADER_SECRET' } },
      },
    });

    const result = await resolve();
    const printable = JSON.stringify(result.config);

    for (const secret of ['tok_SECRET_VALUE', 'HEADER_SECRET', 'QUERY_SECRET']) {
      expect(printable).not.toContain(secret);
    }
    // The names survive — `SERVICE_API_KEY` is the useful half and is safe.
    expect(printable).toContain('SERVICE_API_KEY');
    expect(printable).toContain('Authorization');

    // The launch spec still has what a spawn needs...
    expect(result.launch.get('keyed')?.env.SERVICE_API_KEY).toBe('tok_SECRET_VALUE');
    expect(result.launch.get('bearer')?.headers.Authorization).toBe('Bearer HEADER_SECRET');

    // ...and a careless dump of the WHOLE result still emits nothing, because a Map does not
    // serialize. That is the second lock, deliberately chosen, not a happy accident.
    expect(JSON.stringify(result)).not.toContain('tok_SECRET_VALUE');
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('skills', () => {
  /**
   * 🚨 Five of the fourteen real skills on the author's machine are symlinks into `.agents/skills`.
   * `Dirent.isDirectory()` is FALSE for a symlink, so the first implementation reported 9 of 14 —
   * a 36% undercount with no problem raised. Let the filesystem answer, not the dirent flag.
   */
  it('finds a skill reached through a symlink', async () => {
    const real = join(root, 'elsewhere', 'linked-skill');
    await write(join(real, 'SKILL.md'), skill('linked-skill', 'reached through a link'));
    await write(join(repo, '.claude', 'skills', 'normal', 'SKILL.md'), skill('normal', 'plain directory'));
    await symlink(real, join(repo, '.claude', 'skills', 'linked-skill'));

    const { config } = await resolve();
    expect(config.skills.map((entry) => entry.name).sort()).toEqual(['linked-skill', 'normal']);
  });

  /**
   * 🚨 `~/.claude/skills` on the author's machine holds 30 bare `.md` notes beside 3 real skills.
   * Counting files reported 33; the plan's own §1 quotes "33+ registered" for that reason.
   */
  it('does not count a bare markdown note as a skill', async () => {
    await write(join(home, '.claude', 'skills', 'a-note.md'), '## just a note\n- a bullet\n');
    await write(join(home, '.claude', 'skills', 'real', 'SKILL.md'), skill('real', 'has frontmatter'));

    const { config } = await resolve();
    expect(config.skills.map((entry) => entry.name)).toEqual(['real']);
  });

  it('reports a SKILL.md with no frontmatter as a problem rather than registering it', async () => {
    await write(join(home, '.claude', 'skills', 'broken', 'SKILL.md'), '# no frontmatter\n');

    const { config } = await resolve();
    expect(config.skills).toHaveLength(0);
    expect(config.problems.some((problem) => problem.message.includes('no frontmatter'))).toBe(true);
  });

  it('counts the listing line only, never the body', async () => {
    await write(join(home, '.claude', 'skills', 'x', 'SKILL.md'), skill('x', 'short'));

    const { config } = await resolve();
    // `name: description` — the body in the fixture is far longer than this.
    expect(config.skills[0].listingChars).toBe('x'.length + 2 + 'short'.length);
  });

  it('lets a project skill shadow a user skill of the same name', async () => {
    await write(join(home, '.claude', 'skills', 'dup', 'SKILL.md'), skill('dup', 'user copy'));
    await write(join(repo, '.claude', 'skills', 'dup', 'SKILL.md'), skill('dup', 'project copy'));

    const { config } = await resolve();
    const user = config.skills.find((entry) => entry.scope === 'user');
    const project = config.skills.find((entry) => entry.scope === 'project');
    expect(user?.shadowedBy).toBe('project');
    expect(project?.shadowedBy).toBeNull();
  });

  it('reads a skillOverride onto the skill it names', async () => {
    await write(join(home, '.claude', 'skills', 'demoted', 'SKILL.md'), skill('demoted', 'only ever typed'));
    await write(join(repo, '.claude', 'settings.local.json'), {
      skillOverrides: { demoted: 'user-invocable-only' },
    });

    const { config } = await resolve();
    expect(config.skills[0].override).toBe('user-invocable-only');
  });

  it('records an unknown skillOverride value as a problem instead of accepting it', async () => {
    await write(join(repo, '.claude', 'settings.local.json'), { skillOverrides: { a: 'maybe' } });

    const { config } = await resolve();
    expect(config.problems.some((problem) => problem.message.includes('skillOverrides.a'))).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('mcp servers', () => {
  const projectServer = { mcpServers: { alpha: { command: 'npx', args: ['-y', 'alpha-pkg'] } } };

  it('is off until approved, because Claude Code asks before loading it', async () => {
    await write(join(repo, '.mcp.json'), projectServer);

    const { config } = await resolve();
    expect(config.mcpServers[0].enabled).toBe(false);
    expect(config.mcpServers[0].enabledReason).toMatch(/not yet approved/);
  });

  it('is on under enableAllProjectMcpServers, and the lever is a settings entry', async () => {
    await write(join(repo, '.mcp.json'), projectServer);
    await write(join(home, '.claude', 'settings.json'), { enableAllProjectMcpServers: true });

    const { config } = await resolve();
    expect(config.mcpServers[0].enabled).toBe(true);
    expect(config.mcpServers[0].fixLever.kind).toBe('disabledMcpjsonServers');
    expect(config.mcpServers[0].entry).toBe('alpha-pkg');
  });

  it('honours a disable from any layer, and offers no further lever', async () => {
    await write(join(repo, '.mcp.json'), projectServer);
    await write(join(home, '.claude', 'settings.json'), {
      enableAllProjectMcpServers: true,
      disabledMcpjsonServers: ['alpha'],
    });

    const { config } = await resolve();
    expect(config.mcpServers[0].enabled).toBe(false);
    expect(config.mcpServers[0].fixLever.kind).toBe('none');
  });

  /**
   * 🔑 A user-scope server cannot be turned off from a settings file at all. Emitting a
   * `disabledMcpjsonServers` entry for it would be a fix that silently does nothing, which is
   * worse than offering none.
   */
  it('routes a user-scope server to the CLI, not to settings', async () => {
    await write(join(home, '.claude.json'), { mcpServers: { beta: { command: 'beta' } } });

    const { config } = await resolve();
    // The scope flag is not decoration: `claude mcp remove` without one removes from whichever
    // scope happens to hold the name, so an unscoped command is a different command when the same
    // server is declared twice.
    expect(config.mcpServers[0].fixLever).toEqual({
      kind: 'claude-mcp-remove',
      command: 'claude mcp remove beta -s user',
      scope: 'user',
      path: join(home, '.claude.json'),
    });
    expect(config.mcpServers[0].configuredSince.known).toBe(false);
  });

  /**
   * The `github` plugin ships exactly this file. Reading it anyway would invent a server that
   * Claude Code does not load — no `mcp__github__*` tool has ever appeared despite the plugin
   * being enabled.
   */
  it('reports a .mcp.json missing its mcpServers wrapper instead of guessing', async () => {
    await write(join(repo, '.mcp.json'), { github: { type: 'http', url: 'https://host/mcp' } });

    const { config } = await resolve();
    expect(config.mcpServers).toHaveLength(0);
    expect(config.problems.some((problem) => problem.message.includes('no "mcpServers" key'))).toBe(true);
  });

  it('counts a name declared twice once, and says where the other one is', async () => {
    await write(join(repo, '.mcp.json'), { mcpServers: { dup: { command: 'from-project' } } });
    await write(join(home, '.claude.json'), { mcpServers: { dup: { command: 'from-user' } } });

    const { config } = await resolve();
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].scope).toBe('project-mcp-json');
    expect(config.problems.some((problem) => problem.message.includes('counted once'))).toBe(true);
  });

  it('turns a plugin server off with the plugin, and names the plugin as the reason', async () => {
    const installPath = join(root, 'plugins', 'thing');
    await write(join(installPath, '.mcp.json'), { mcpServers: { gamma: { command: 'gamma' } } });
    await write(join(home, '.claude', 'plugins', 'installed_plugins.json'), {
      version: 2,
      plugins: { 'thing@market': [{ scope: 'user', installPath, installedAt: '2026-01-02T00:00:00Z' }] },
    });

    const { config } = await resolve();
    expect(config.mcpServers[0].enabled).toBe(false);
    expect(config.mcpServers[0].enabledReason).toContain('thing@market');
  });

  /**
   * 🚨 A plugin's `.mcp.json` sits inside the plugin author's own checkout, so `git log` there
   * answers when THEY added the server, which in practice dates a plugin's servers months before
   * the plugin was ever installed locally. The registry's install date is the one that means
   * anything.
   */
  it('dates a plugin server from when it was installed here, not from the plugin repo', async () => {
    const installPath = join(root, 'plugins', 'thing');
    await write(join(installPath, '.mcp.json'), { mcpServers: { gamma: { command: 'gamma' } } });
    await write(join(home, '.claude', 'plugins', 'installed_plugins.json'), {
      version: 2,
      plugins: { 'thing@market': [{ scope: 'user', installPath, installedAt: '2026-05-15T16:30:57.975Z' }] },
    });
    await write(join(home, '.claude', 'settings.json'), { enabledPlugins: { 'thing@market': true } });

    const { config } = await resolve();
    expect(config.mcpServers[0].configuredSince).toEqual({
      known: true,
      iso: '2026-05-15T16:30:57.975Z',
      commit: null,
      via: 'plugin-install',
    });
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('plugins', () => {
  it('does not load skills from an installed but disabled plugin', async () => {
    const installPath = join(root, 'plugins', 'big');
    await write(join(installPath, 'skills', 'huge', 'SKILL.md'), skill('huge', 'fourteen of these'));
    await write(join(home, '.claude', 'plugins', 'installed_plugins.json'), {
      version: 2,
      plugins: { 'big@market': [{ scope: 'user', installPath }] },
    });

    const { config } = await resolve();
    // Installed is not enabled. `superpowers` sits in exactly this state on the author's machine,
    // with 14 skills that reach no session.
    expect(config.skills).toHaveLength(0);
    expect(config.plugins.find((plugin) => plugin.id === 'big@market')?.enabled).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('memory', () => {
  it('separates the always-loaded chain from a nested file that loads on demand', async () => {
    await write(join(home, '.claude', 'CLAUDE.md'), '# user\n');
    await write(join(repo, 'CLAUDE.md'), '# root\n');
    await write(join(repo, 'packages', 'frontend', 'CLAUDE.md'), '# nested\n');

    const { config } = await resolve();
    const byKind = Object.fromEntries(config.memory.map((file) => [file.kind, file]));
    expect(byKind.user.alwaysLoaded).toBe(true);
    expect(byKind['project-root'].alwaysLoaded).toBe(true);
    // Injected only when a file under it is touched. Folding it into the per-turn prefix would
    // overstate the tax.
    expect(byKind['project-nested'].alwaysLoaded).toBe(false);
  });

  it('never walks into node_modules', async () => {
    await write(join(repo, 'node_modules', 'pkg', 'CLAUDE.md'), '# vendored\n');

    const { config } = await resolve();
    expect(config.memory).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('sessionsSince', () => {
  const session = (id: string, firstSeen: string, kind: SessionEvidence['kind'] = 'session'): SessionEvidence =>
    ({
      sessionId: id,
      file: `${id}.jsonl`,
      kind,
      cwd: '/repo',
      turns: 1,
      sidechainTurns: 0,
      coldStartTokens: null,
      contextTokens: 0,
      outputTokens: 0,
      firstSeen,
      lastSeen: firstSeen,
    }) satisfies SessionEvidence;

  it('counts only sessions that started after the config did', () => {
    const sessions = [session('a', '2026-01-01T00:00:00Z'), session('b', '2026-03-01T00:00:00Z')];
    expect(sessionsSince(sessions, { known: true, iso: '2026-02-01T00:00:00Z', commit: 'abc', via: 'git' })).toBe(1);
  });

  /** A subagent transcript is billed work but not a session a human started. */
  it('excludes subagent transcripts from the denominator', () => {
    const sessions = [
      session('a', '2026-03-01T00:00:00Z'),
      session('b', '2026-03-01T00:00:00Z', 'subagent'),
    ];
    expect(sessionsSince(sessions, { known: true, iso: '2026-01-01T00:00:00Z', commit: 'abc', via: 'git' })).toBe(1);
  });

  /** 🔑 Unknown must stay unknown. Rendering it as zero is the failure this guard exists to stop. */
  it('returns null rather than zero when the config date is unknown', () => {
    expect(sessionsSince([session('a', '2026-03-01T00:00:00Z')], { known: false, reason: 'no git' })).toBeNull();
  });
});
