/**
 * The join, which is where this package earns its keep and where it would lose its reader.
 *
 * Almost every test here is about a claim the tool must *not* make. Getting a cost wrong by 10% is
 * a bad estimate; telling somebody a server they added on Tuesday is dead weight is a tool they
 * stop believing. The verdicts are therefore tested from the direction of what they refuse to say.
 *
 * Tests marked 🚨 pin a mistake that was actually made, twice, by hand, while building this.
 */

import { describe, expect, it } from 'vitest';

import type { Evidence, ProjectEvidence, SessionEvidence } from '../evidence/types.js';
import { buildLedger } from '../ledger/index.js';
import type { MeasureResult, MeasuredMcpServer } from '../measure/types.js';
import type { McpLaunchSpec, ResolveResult, ResolvedConfig, ResolvedMcpServer } from '../resolve/types.js';

const ROOT = '/repo';

function session(overrides: Partial<SessionEvidence> = {}): SessionEvidence {
  return {
    sessionId: 'a',
    file: '/x.jsonl',
    kind: 'session',
    cwd: ROOT,
    turns: 100,
    sidechainTurns: 0,
    coldStartTokens: 50_000,
    contextTokens: 1_000_000,
    outputTokens: 1_000,
    firstSeen: '2026-06-01T00:00:00.000Z',
    lastSeen: '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

function project(overrides: Partial<ProjectEvidence> = {}): ProjectEvidence {
  return {
    cwd: ROOT,
    sessions: 1,
    turns: 100,
    sidechainTurns: 0,
    contextTokens: 1_000_000,
    outputTokens: 1_000,
    coldStart: null,
    firstSeen: '2026-06-01T00:00:00.000Z',
    lastSeen: '2026-06-01T01:00:00.000Z',
    mcpServers: {},
    builtinTools: {},
    skills: {},
    agents: {},
    slashCommands: {},
    ...overrides,
  };
}

function evidence(sessions: SessionEvidence[], projects: ProjectEvidence[]): Evidence {
  return { scannedFiles: sessions.length, malformedLines: 0, sessions, projects };
}

function server(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    name: 'srv',
    transport: 'stdio',
    command: 'node',
    argCount: 1,
    entry: 'pkg',
    envKeys: [],
    url: null,
    headerKeys: [],
    scope: 'project-mcp-json',
    path: `${ROOT}/.mcp.json`,
    plugin: null,
    enabled: true,
    enabledReason: 'on',
    fixLever: { kind: 'disabledMcpjsonServers', settingsPath: `${ROOT}/.claude/settings.local.json` },
    configuredSince: { known: true, iso: '2026-01-01T00:00:00.000Z', commit: 'abc', via: 'git' },
    ...overrides,
  };
}

function measured(overrides: Partial<MeasuredMcpServer> = {}): MeasuredMcpServer {
  return {
    name: 'srv',
    status: { kind: 'measured', at: '2026-09-01T00:00:00.000Z' },
    toolCount: 2,
    // Loaded and resident are deliberately different numbers: every per-turn claim in the ledger
    // has to come from the resident one, and a fixture where they matched could not tell.
    chars: 13_000,
    tokens: 3_250,
    residentChars: 4_000,
    residentTokens: 1_000,
    instructionsChars: 0,
    instructionsDroppedChars: 0,
    unsentChars: 0,
    transportUsed: 'stdio',
    tools: [
      { name: 'one', chars: 6_500, listingChars: 2_000 },
      { name: 'two', chars: 6_500, listingChars: 2_000 },
    ],
    ...overrides,
  };
}

function resolveResult(servers: ResolvedMcpServer[], config: Partial<ResolvedConfig> = {}): ResolveResult {
  return {
    config: {
      cwd: ROOT,
      repoRoot: ROOT,
      settingsTarget: `${ROOT}/.claude/settings.local.json`,
      sources: [],
      mcpServers: servers,
      skills: [],
      agents: [],
      commands: [],
      memory: [],
      plugins: [],
      problems: [],
      ...config,
    },
    launch: new Map<string, McpLaunchSpec>(),
  };
}

function measureResult(servers: MeasuredMcpServer[]): MeasureResult {
  return {
    contacted: [],
    spawned: [],
    servers,
    skills: { items: 0, chars: 0, tokens: 0 },
    agents: { items: 0, chars: 0, tokens: 0 },
    memory: { items: 0, chars: 0, tokens: 0 },
    measuredTokens: servers.reduce((sum, entry) => sum + (entry.tokens ?? 0), 0),
    residentTokens: servers.reduce((sum, entry) => sum + (entry.residentTokens ?? 0), 0),
    unsplit: servers.filter((entry) => entry.tokens !== null && entry.residentTokens === null).length,
    unmeasured: 0,
    problems: [],
  };
}

/** Twelve sessions, so a `never-called` verdict has room to be reached. */
const twelveSessions = Array.from({ length: 12 }, (_, index) =>
  session({ sessionId: `s${index}`, firstSeen: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` }),
);

/* ---------------------------------------------------------------------------------------- */

describe('what the verdicts refuse to claim', () => {
  it('🚨 will not call a server dead when nothing records how long it has been there', () => {
    // ~/.claude.json is not version controlled. Zero calls is real, but it is not evidence of age,
    // and the reader is the only one who knows which. This is the guard that keeps the tool from
    // becoming the linter it replaced.
    const ledger = buildLedger(
      resolveResult([
        server({
          scope: 'user',
          configuredSince: { known: false, reason: 'declared in ~/.claude.json, which is not version controlled' },
        }),
      ]),
      measureResult([measured()]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.rows[0].verdict.kind).toBe('never-called-age-unknown');
    expect(ledger.findings).toEqual([]);
  });

  it('will not call a server dead when it has only been there a few sessions', () => {
    const ledger = buildLedger(
      resolveResult([
        server({ configuredSince: { known: true, iso: '2026-06-10T00:00:00.000Z', commit: 'a', via: 'git' } }),
      ]),
      measureResult([measured()]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.rows[0].verdict).toMatchObject({ kind: 'too-new', sessions: 3 });
    expect(ledger.findings).toEqual([]);
  });

  it('does call it dead once there is a window to say it across, and prints the window', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.rows[0].verdict).toMatchObject({ kind: 'never-called', sessions: 12 });
    expect(ledger.findings[0].detail).toContain('12 sessions');
    expect(ledger.findings[0].saves).toBe(1_000);
  });

  it('🚨 charges a turn for what the turn carries, not for the schemas waiting behind it', () => {
    // Measured 2026-09-02: the client defers tool schemas, so the loaded figure is what a load
    // costs and not what a turn costs. Charging the loaded figure per turn overstated acme by
    // 3.2x, and every verdict, share and per-call number in this file rests on the difference.
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.rows[0].tokens).toBe(1_000);
    expect(ledger.rows[0].loadedTokens).toBe(3_250);
    expect(ledger.findings[0].headline).toContain('1,000 tokens every turn');
    expect(ledger.findings[0].headline).not.toContain('3,250');
    expect(ledger.reconciliation.attributed).toBe(1_000);
  });

  it('still says what the deferred half costs, because it is paid the moment anything loads it', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.findings[0].detail).toContain('2,250 tokens more');
  });

  it('🚨 counts only sessions in this directory tree, not ones whose bucket merely looks similar', () => {
    // A sibling repo produces a slug that shares a prefix with this one. Two hand-written greps
    // during development both fell for exactly this and over-counted: one by 27 calls, one by two
    // orders of magnitude. The real `cwd` is what decides, never the bucket name.
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(
        [...twelveSessions, session({ sessionId: 'other', cwd: '/repo-landing-page' })],
        [project(), project({ cwd: '/repo-landing-page', mcpServers: { srv: { calls: 99, sessions: 1, tools: {} } } })],
      ),
    );
    expect(ledger.rows[0].calls).toBe(0);
    expect(ledger.rows[0].verdict).toMatchObject({ kind: 'never-called', sessions: 12 });
  });

  it('counts a subdirectory of the tree as part of it', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions, [
        project({ cwd: `${ROOT}/packages/api`, mcpServers: { srv: { calls: 40, sessions: 5, tools: { one: 40 } } } }),
      ]),
    );
    expect(ledger.rows[0].calls).toBe(40);
  });
});

describe('the cost floor', () => {
  it('multiplies by turns, because the schema is re-sent whether or not you call it', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions, [project({ turns: 1_200, mcpServers: { srv: { calls: 2, sessions: 1, tools: { one: 2 } } } })]),
    );
    // 1,000 tokens on every one of 1,200 turns, for 2 calls.
    expect(ledger.rows[0].perCall).toBe((1_000 * 1_200) / 2);
  });

  it('excludes subagent turns, which carry a different prefix and were never charged this one', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(
        twelveSessions.map((entry) => ({ ...entry, turns: 100, sidechainTurns: 40 })),
        [project({ mcpServers: { srv: { calls: 1, sessions: 1, tools: { one: 1 } } } })],
      ),
    );
    // 12 sessions x (100 - 40) main-loop turns.
    expect(ledger.rows[0].perCall).toBe(1_000 * 12 * 60);
  });

  it('charges a server only for turns taken after it was configured', () => {
    const late = server({
      configuredSince: { known: true, iso: '2026-06-07T00:00:00.000Z', commit: 'a', via: 'git' },
    });
    const ledger = buildLedger(
      resolveResult([late]),
      measureResult([measured()]),
      evidence(twelveSessions, [project({ mcpServers: { srv: { calls: 1, sessions: 1, tools: { one: 1 } } } })]),
    );
    // Six of the twelve sessions started on or after the 7th, at 100 main-loop turns each.
    expect(ledger.rows[0].perCall).toBe(1_000 * 6 * 100);
  });

  it('flags a server used in a handful of sessions out of a hundred, not only one at zero', () => {
    const hundred = Array.from({ length: 100 }, (_, index) =>
      session({ sessionId: `s${index}`, firstSeen: `2026-06-01T00:00:${String(index % 60).padStart(2, '0')}.000Z` }),
    );
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(hundred, [project({ mcpServers: { srv: { calls: 1, sessions: 1, tools: { one: 1 } } } })]),
    );
    expect(ledger.rows[0].verdict).toMatchObject({ kind: 'rarely-called', calls: 1, sessions: 100 });
    expect(ledger.findings[0].headline).toContain('used in 1 of 100 sessions');
  });

  it('leaves a well-used server alone', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions, [project({ mcpServers: { srv: { calls: 200, sessions: 12, tools: { one: 100, two: 100 } } } })]),
    );
    expect(ledger.rows[0].verdict.kind).toBe('earning-it');
    expect(ledger.findings).toEqual([]);
  });

  it('names the idle tools of a server worth keeping, and prices both halves of them', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions, [project({ mcpServers: { srv: { calls: 200, sessions: 12, tools: { one: 200 } } } })]),
    );
    expect(ledger.rows[0].verdict.kind).toBe('earning-it');
    expect(ledger.findings).toHaveLength(1);
    expect(ledger.findings[0].headline).toBe('srv: 1 of its 2 tools have never been called');
    // The listing is paid every turn and the schema only when something loads it, so a finding
    // that collapsed them into one number would have to pick which of the two to misreport.
    expect(ledger.findings[0].detail).toContain('500 tokens on every turn');
    expect(ledger.findings[0].detail).toContain('1,625 tokens of schema');
    // There is no per-tool switch in the protocol, so there must be nothing to execute.
    expect(ledger.findings[0].actions).toEqual([]);
  });

  it('\u{1f6a8} says nothing about the tools of a server that has renamed them, rather than calling all of them dead', () => {
    // Found by running the tool against a real project. The server is used constantly, but every
    // call on record names a tool it no longer declares, so each *current* tool has zero calls
    // against it. The old guard asked only for more than one tool, so it printed "8 of its 8
    // tools have never been called" on the same screen as a row reading 372 calls.
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions, [
        project({ mcpServers: { srv: { calls: 372, sessions: 12, tools: { was_one: 200, was_two: 172 } } } }),
      ]),
    );
    expect(ledger.rows[0].verdict).toMatchObject({ kind: 'earning-it', calls: 372 });
    expect(ledger.findings).toEqual([]);
  });
});

describe('servers that will not start', () => {
  it('reports the failure as its own finding, and offers repair before removal', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([
        measured({ status: { kind: 'unmeasured', reason: 'npm error 404', cause: 'failed' }, tokens: null, chars: null }),
      ]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.rows[0].verdict).toMatchObject({ kind: 'broken' });
    expect(ledger.findings[0].fix).toMatch(/^repair it/);
  });

  it('does not treat a server we declined to start as a broken one', () => {
    const ledger = buildLedger(
      resolveResult([server({ enabled: false })]),
      measureResult([
        measured({
          status: { kind: 'unmeasured', reason: 'configured but off', cause: 'declined' },
          tokens: null,
          chars: null,
        }),
      ]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.rows[0].verdict.kind).toBe('not-measured');
    expect(ledger.findings).toEqual([]);
  });
});

describe('reconciliation against what was billed', () => {
  it('splits the exact total into what it could attribute and what it could not', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions, [project({ mcpServers: { srv: { calls: 50, sessions: 12, tools: { one: 50 } } } })]),
    );
    const { total, attributed, unattributed } = ledger.reconciliation;
    expect(total).toBe(50_000);
    expect(attributed).toBe(1_000);
    expect((unattributed ?? 0) + attributed).toBe(total);
  });

  it('🚨 says so rather than printing a negative remainder when the rows exceed what was billed', () => {
    // The measurement contract: rows may never sum to more than the exact total. When they do the
    // estimator is wrong, and fudging it into a smaller `unattributed` would hide that.
    const ledger = buildLedger(
      resolveResult([server()]),
      // The resident figure is what gets attributed, so that is the one this test has to inflate.
      measureResult([measured({ residentTokens: 90_000 })]),
      evidence(twelveSessions, [project({ mcpServers: { srv: { calls: 50, sessions: 12, tools: { one: 50 } } } })]),
    );
    expect(ledger.reconciliation.overAttributed).toBe(true);
    expect(ledger.reconciliation.unattributed).toBeNull();
  });

  it('reports no total rather than a made-up one when no session recorded a cold start', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(twelveSessions.map((entry) => ({ ...entry, coldStartTokens: null })), [project()]),
    );
    expect(ledger.reconciliation.total).toBeNull();
    expect(ledger.rows[0].share).toBeNull();
  });
});

describe('skills', () => {
  const skill = (name: string, plugin: string | null) => ({
    name,
    description: 'd',
    scope: plugin === null ? ('user' as const) : ('plugin' as const),
    path: '/x',
    plugin,
    listingChars: 40,
    shadowedBy: null,
    override: null,
  });

  it('🚨 widens a colliding name until it is distinct, since a repeated entry reads as a bug', () => {
    // Two marketplaces ship a plugin called `frontend-design`, each with a skill of the same name.
    // Prefixing with the plugin alone prints the identical string twice.
    const ledger = buildLedger(
      resolveResult([], {
        skills: [skill('frontend-design', 'frontend-design@one'), skill('frontend-design', 'frontend-design@two')],
      }),
      measureResult([]),
      evidence(twelveSessions, [project()]),
    );
    const detail = ledger.findings[0].detail;
    expect(detail).toContain('frontend-design@one:frontend-design');
    expect(detail).toContain('frontend-design@two:frontend-design');
  });

  it('recommends demoting a skill you only ever type, rather than removing it', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [skill('typed', null)] }),
      measureResult([]),
      evidence(twelveSessions, [project({ slashCommands: { typed: 9 } })]),
    );
    expect(ledger.findings[0].headline).toContain('only ever type');
    expect(ledger.findings[0].fix).toContain('skillOverrides');
  });

  it('routes a plugin skill away from skillOverrides, which would silently do nothing to it', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [skill('typed', 'pack@market')] }),
      measureResult([]),
      evidence(twelveSessions, [project({ slashCommands: { typed: 9 } })]),
    );
    expect(ledger.findings[0].fix).toContain('enabledPlugins');
  });

  it('leaves a skill the model actually chooses alone', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [skill('used', null)] }),
      measureResult([]),
      evidence(twelveSessions, [project({ skills: { used: { model: 7, user: 0 } } })]),
    );
    expect(ledger.findings).toEqual([]);
  });
});

/* ------------------------------ what --fix is allowed to write ---------------------------- */

/**
 * The actions the ledger hands to `--fix`.
 *
 * The findings and the actions are generated on the same branch, from the same evidence, so a
 * reader who confirms a sentence and a writer who lands an edit cannot be describing two different
 * things. These tests are mostly about the edits that must NOT be produced.
 */
describe('the actions behind a finding', () => {
  const skill = (name: string, plugin: string | null, listingChars = 400) => ({
    name,
    description: 'd',
    scope: plugin === null ? ('user' as const) : ('plugin' as const),
    path: '/x',
    plugin,
    listingChars,
    shadowedBy: null,
    override: null,
  });

  const plugin = (id: string) => ({
    id,
    enabled: true,
    enabledBy: '/home/.claude/settings.json',
    installPath: '/plugins/x',
    scope: 'user',
    installedAt: '2026-01-01T00:00:00.000Z',
  });

  it('turns a never-called project server into one settings edit', () => {
    const ledger = buildLedger(
      resolveResult([server({ name: 'ghost' })]),
      measureResult([measured({ name: 'ghost' })]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.actions).toEqual([
      {
        kind: 'disable-mcpjson-server',
        server: 'ghost',
        settingsPath: `${ROOT}/.claude/settings.local.json`,
        why: expect.stringContaining('never been called'),
        saves: 1_000,
      },
    ]);
  });

  /**
   * 🔒 `~/.claude.json` holds live API keys. This tool does not rewrite it and does not back it up,
   * so a server declared there leaves as a command the reader runs — scoped, because an unscoped
   * `claude mcp remove` removes from whichever scope happens to hold the name.
   */
  it('hands a user-scope server back as a scoped command, never as a settings write', () => {
    const ledger = buildLedger(
      resolveResult([
        server({
          name: 'ghost',
          scope: 'user',
          fixLever: { kind: 'claude-mcp-remove', command: 'claude mcp remove ghost -s user', scope: 'user', path: '/home/.claude.json' },
          configuredSince: { known: false, reason: 'not version controlled' },
        }),
      ]),
      measureResult([measured({ name: 'ghost' })]),
      // One call in twelve sessions: below the floor, so `rarely-called` fires and produces a fix.
      evidence(twelveSessions, [project({ mcpServers: { ghost: { calls: 1, sessions: 1, tools: {} } } })]),
    );
    expect(ledger.actions).toEqual([
      { kind: 'manual', command: 'claude mcp remove ghost -s user', why: expect.any(String) },
    ]);
  });

  /**
   * 🚨 A server that cannot start is a thing to repair. Switching it off would destroy the evidence
   * that it is broken, and the row would silently become a server you no longer have.
   */
  it('proposes nothing for a broken server', () => {
    const ledger = buildLedger(
      resolveResult([server({ name: 'ghost' })]),
      measureResult([
        measured({
          name: 'ghost',
          status: { kind: 'unmeasured', reason: 'spawn failed', cause: 'failed' },
          tokens: null,
        }),
      ]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.findings[0].headline).toContain('cannot start');
    expect(ledger.actions).toEqual([]);
  });

  /** No defensible denominator, no write. This is the credibility rule, carried into the writer. */
  it('proposes nothing when nothing on disk says how old the server is', () => {
    const ledger = buildLedger(
      resolveResult([
        server({ name: 'ghost', configuredSince: { known: false, reason: 'not version controlled' } }),
      ]),
      measureResult([measured({ name: 'ghost' })]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.rows[0].verdict.kind).toBe('never-called-age-unknown');
    expect(ledger.actions).toEqual([]);
  });

  it('proposes nothing for a server too new to judge', () => {
    const recent = twelveSessions.slice(0, 2);
    const ledger = buildLedger(
      resolveResult([
        server({ name: 'ghost', configuredSince: { known: true, iso: '2026-05-30T00:00:00.000Z', commit: 'a', via: 'git' } }),
      ]),
      measureResult([measured({ name: 'ghost' })]),
      evidence(recent, [project()]),
    );
    expect(ledger.rows[0].verdict.kind).toBe('too-new');
    expect(ledger.actions).toEqual([]);
  });

  /**
   * 🚨 `skillOverrides` has no effect on a plugin skill. Emitting one would write a file, report
   * success and change nothing — the worst possible outcome for a tool whose whole argument is that
   * the other tools guess.
   */
  it('never writes a skillOverrides entry for a plugin skill', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [skill('dead', 'pack@market')], plugins: [plugin('pack@market')] }),
      measureResult([]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.actions.some((entry) => entry.kind === 'skill-override')).toBe(false);
  });

  /**
   * 🚨 The all-or-nothing guard. `enabledPlugins` switches off a plugin's servers, skills, agents
   * and commands together, so one unused skill is not a reason to take four working things with it.
   */
  it('refuses the whole-plugin switch when anything the plugin provides is in use', () => {
    const ledger = buildLedger(
      resolveResult([], {
        skills: [skill('dead', 'pack@market'), skill('alive', 'pack@market')],
        plugins: [plugin('pack@market')],
      }),
      measureResult([]),
      evidence(twelveSessions, [project({ skills: { alive: { model: 9, user: 0 } } })]),
    );
    expect(ledger.actions.some((entry) => entry.kind === 'disable-plugin')).toBe(false);
    expect(ledger.actions).toEqual([
      { kind: 'manual', command: null, why: expect.stringContaining('does not apply to plugin skills') },
    ]);
  });

  it('offers the whole-plugin switch when nothing it provides has been used, and adds the savings up', () => {
    const ledger = buildLedger(
      resolveResult([], {
        skills: [skill('one', 'pack@market', 400), skill('two', 'pack@market', 800)],
        plugins: [plugin('pack@market')],
      }),
      measureResult([]),
      evidence(twelveSessions, [project()]),
    );
    // One edit, not two: both skills point at the same `enabledPlugins` entry, and switching it
    // off recovers both listings.
    expect(ledger.actions).toEqual([
      {
        kind: 'disable-plugin',
        plugin: 'pack@market',
        settingsPath: `${ROOT}/.claude/settings.local.json`,
        why: expect.any(String),
        saves: 300,
      },
    ]);
  });

  /**
   * 🚨 The evidence is scoped to sessions under this repo, so the edit has to be too. Writing to
   * `~/.claude/settings.json` — where the plugin was enabled — would turn *"unused here"* into
   * *"off on this machine"*, which is not what was measured.
   */
  it('writes a plugin switch to this project, not to the file that enabled the plugin', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [skill('one', 'pack@market')], plugins: [plugin('pack@market')] }),
      measureResult([]),
      evidence(twelveSessions, [project()]),
    );
    const [only] = ledger.actions;
    expect(only.kind === 'disable-plugin' && only.settingsPath).toBe(`${ROOT}/.claude/settings.local.json`);
  });

  /**
   * 🚨 The `Skill` tool records either `name` or `plugin:name`, and this machine's transcripts hold
   * both forms for the same skill. Matching only the bare name loses the prefixed calls, which turns
   * something you use into a `never invoked` finding — and, behind `--fix`, into a write that
   * switches it off.
   */
  it('counts a plugin skill invoked by its prefixed name as used', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [skill('design', 'pack@market')], plugins: [plugin('pack@market')] }),
      measureResult([]),
      evidence(twelveSessions, [project({ skills: { 'pack:design': { model: 6, user: 0 } } })]),
    );
    expect(ledger.findings).toEqual([]);
    expect(ledger.actions).toEqual([]);
  });

  it('counts an agent invoked by its prefixed subagent_type as use of its plugin', () => {
    const ledger = buildLedger(
      resolveResult([], {
        skills: [skill('dead', 'pack@market')],
        agents: [{ name: 'reviewer', description: 'd', scope: 'plugin', path: '/x', plugin: 'pack@market', tools: null, listingChars: 40, shadowedBy: null }],
        plugins: [plugin('pack@market')],
      }),
      measureResult([]),
      evidence(twelveSessions, [project({ agents: { 'pack:reviewer': 3 } })]),
    );
    expect(ledger.actions.some((entry) => entry.kind === 'disable-plugin')).toBe(false);
  });

  it('demotes a typed-only skill rather than switching it off', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [skill('typed', null)] }),
      measureResult([]),
      evidence(twelveSessions, [project({ slashCommands: { typed: 9 } })]),
    );
    expect(ledger.actions).toEqual([
      {
        kind: 'skill-override',
        skill: 'typed',
        value: 'user-invocable-only',
        settingsPath: `${ROOT}/.claude/settings.local.json`,
        why: expect.stringContaining('never chosen by the model'),
        saves: 100,
      },
    ]);
  });
});
