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

import type { Evidence, ProjectEvidence, SentRecord, SentSkill, SessionEvidence } from '../evidence/types.js';
import { buildLedger } from '../ledger/index.js';
import { fractionToSendAll, pickRecord, readSentListing } from '../ledger/sent.js';
import { toListedSkills } from '../measure/skill-listing.js';
import type { MeasureResult, MeasuredMcpServer } from '../measure/types.js';
import type { McpLaunchSpec, ResolveResult, ResolvedConfig, ResolvedMcpServer } from '../resolve/types.js';

const ROOT = '/repo';

function session(overrides: Partial<SessionEvidence> = {}): SessionEvidence {
  return {
    sessionId: 'a',
    file: '/x.jsonl',
    kind: 'session',
    headless: false,
    cwd: ROOT,
    turns: 100,
    sidechainTurns: 0,
    coldStartTokens: 50_000,
    contextTokens: 1_000_000,
    peakContextTokens: 150_000,
    outputTokens: 1_000,
    firstSeen: '2026-06-01T00:00:00.000Z',
    lastSeen: '2026-06-01T01:00:00.000Z',
    record: null,
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
  return { scannedFiles: sessions.length, malformedLines: 0, unreadable: [], sessions, projects };
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
      skillListing: { budgetFraction: null, maxDescChars: null, envBudgetChars: null },
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
    whenToUse: null,
    modelInvocable: true,
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

  /**
   * 🚨 A plugin skill you type is, by that fact, in a plugin you use. `skillOverrides` does nothing
   * to it and `enabledPlugins` would take the slash command away, so the line names neither as the
   * fix. It used to point at `enabledPlugins`.
   */
  it('routes a plugin skill away from skillOverrides, which would silently do nothing to it', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [skill('typed', 'pack@market')] }),
      measureResult([]),
      evidence(twelveSessions, [project({ slashCommands: { typed: 9 } })]),
    );
    expect(ledger.findings[0].fix).toContain('does not apply to plugin skills');
    expect(ledger.findings[0].fix).not.toContain('enabledPlugins');
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
  /**
   * `lineChars` is the whole listing line, `- name: description`, and the description is really
   * that long. A fixture that claimed 400 characters over a one-letter description was costed at
   * its claim, which is the same mistake the ledger used to make about a real config.
   */
  const skill = (name: string, plugin: string | null, lineChars = 400) => {
    const listingName = plugin === null ? name : `${plugin.split('@')[0]}:${name}`;
    return skillOf(name, plugin, 'd'.repeat(lineChars - listingName.length - 4));
  };
  const skillOf = (name: string, plugin: string | null, description: string) => ({
    name,
    description,
    whenToUse: null,
    modelInvocable: true,
    scope: plugin === null ? ('user' as const) : ('plugin' as const),
    path: '/x',
    plugin,
    listingChars: name.length + 2 + description.length,
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

  /**
   * 🚨 `failed` means this tool could not start it. A remote server behind a login answers the
   * client, which holds the token, and answers this tool with a 401. The transcripts are the exact
   * half of the evidence, so when they show calls the server is not broken, the probe is blind.
   */
  it('🚨 does not call a server broken when your sessions are calling it', () => {
    const ledger = buildLedger(
      resolveResult([server({ name: 'remote' })]),
      measureResult([
        measured({
          name: 'remote',
          status: { kind: 'unmeasured', reason: 'HTTP 401 Unauthorized.', cause: 'failed' },
          tokens: null,
          residentTokens: null,
        }),
      ]),
      evidence(twelveSessions, [project({ mcpServers: { remote: { calls: 40, sessions: 9, tools: {} } } })]),
    );
    expect(ledger.rows[0].verdict).toEqual({
      kind: 'not-measured',
      reason: expect.stringContaining('it has answered 40 calls'),
    });
    expect(ledger.findings).toEqual([]);
  });

  /** A server with no tools weighs nothing and cannot be called. Neither fact is a finding. */
  it('says nothing about a server that costs nothing', () => {
    const ledger = buildLedger(
      resolveResult([server({ name: 'empty' })]),
      measureResult([
        measured({ name: 'empty', toolCount: 0, chars: 0, tokens: 0, residentChars: 0, residentTokens: 0, tools: [] }),
      ]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.rows[0].verdict.kind).toBe('never-called');
    expect(ledger.findings).toEqual([]);
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

  /**
   * 🚨 The client caps the skill listing, so a skill is costed as what is sent and a saving is the
   * listing before minus the listing after. The config below is the shape that broke the old sum:
   * one plugin you do use, shipping far more description than the listing has room for.
   */
  describe('a plugin bigger than the listing has room for', () => {
    const bigPlugin = Array.from({ length: 80 }, (_, index) => skill(`skill-${index}`, 'pack@market', 1_000));
    const usedServer = project({ skills: { 'pack:skill-0': { model: 4, user: 0 } } });
    const skillsRow = (ledger: ReturnType<typeof buildLedger>) => ledger.rows.find((row) => row.kind === 'skills');

    it('costs the row at the budget, not at the 80,000 characters on disk', () => {
      const ledger = buildLedger(
        resolveResult([], { skills: bigPlugin, plugins: [plugin('pack@market')] }),
        measureResult([]),
        evidence(twelveSessions, [usedServer]),
      );
      const row = skillsRow(ledger);
      // 8,000 characters is 1% of the default window, which is 2,000 tokens. The sum of lines
      // would have printed 20,000.
      expect(row?.tokens).toBeLessThanOrEqual(2_000);
      expect(row?.tokens).toBeGreaterThan(1_500);
      expect(row?.verdict).toMatchObject({ why: expect.stringContaining('caps it at 8,000') });
      // No session here recorded a listing, so the row has to say it was modelled.
      expect(row?.verdict).toMatchObject({ why: expect.stringContaining('modelled') });
      expect(ledger.source).toEqual({ kind: 'measured' });
    });

    it('promises nothing for skills that have no switch', () => {
      const ledger = buildLedger(
        resolveResult([], { skills: bigPlugin, plugins: [plugin('pack@market')] }),
        measureResult([]),
        evidence(twelveSessions, [usedServer]),
      );
      // 79 skills never invoked, every one of them a plugin skill in a plugin that is used. `fix`
      // can write nothing for them, so the headline cannot count them.
      expect(ledger.findings).toHaveLength(1);
      expect(ledger.findings[0].saves).toBe(0);
      expect(ledger.recoverable).toBe(0);
    });

    it('sizes the budget to the window a session proves', () => {
      const bigWindow = twelveSessions.map((entry) => ({ ...entry, peakContextTokens: 412_000 }));
      const ledger = buildLedger(
        resolveResult([], { skills: bigPlugin, plugins: [plugin('pack@market')] }),
        measureResult([]),
        evidence(bigWindow, [usedServer]),
      );
      const row = skillsRow(ledger);
      expect(row?.tokens).toBeGreaterThan(9_000);
      expect(row?.tokens).toBeLessThanOrEqual(10_000);
      expect(row?.verdict).toMatchObject({ why: expect.stringContaining('1,000,000-token window') });
    });

    it('saves next to nothing by switching off your own skills while the plugin fills the room', () => {
      const ledger = buildLedger(
        resolveResult([], {
          skills: [skill('mine', null, 1_000), ...bigPlugin],
          plugins: [plugin('pack@market')],
        }),
        measureResult([]),
        evidence(twelveSessions, [usedServer]),
      );
      const mine = ledger.actions.find((action) => action.kind === 'skill-override');
      // A sum of lines says 250 tokens. The listing is over budget, so the room goes to the plugin.
      expect(mine?.saves).toBeLessThan(50);
      expect(ledger.findings[0].detail).toContain('over its budget');
    });
  });

  it('🚨 says the same number in the headline, the finding and the plan', () => {
    const ledger = buildLedger(
      resolveResult([], {
        skills: [
          skill('one', null, 333),
          skill('two', null, 777),
          skill('three', 'used@market', 500),
          skill('four', 'used@market'),
        ],
        plugins: [plugin('used@market')],
      }),
      measureResult([]),
      // `four` is what makes the plugin one you use, which is what leaves `three` without a switch.
      evidence(twelveSessions, [project({ skills: { 'used:four': { model: 3, user: 0 } } })]),
    );
    const planned = ledger.actions.reduce((sum, action) => sum + ('saves' in action ? (action.saves ?? 0) : 0), 0);
    const found = ledger.findings.reduce((sum, finding) => sum + (finding.saves ?? 0), 0);
    expect(planned).toBe(found);
    expect(ledger.recoverable).toBe(found);
    // `one` and `two` leave with their newlines: 333 + 777 + 2. `three` has no switch.
    expect(found).toBe(Math.round(1_112 / 4));
  });

  /**
   * 🚨 A plugin you use has no per-skill switch, and that is one fact about the plugin. It used to be
   * said once per skill, so a plugin with a hundred unused skills buried the edits `fix` does make
   * under a hundred copies of one sentence.
   */
  describe('skills with no switch of their own', () => {
    const notes = (ledger: ReturnType<typeof buildLedger>) =>
      ledger.actions.filter((action) => action.kind === 'manual');

    it('hands a plugin back once, with the count, not once per skill', () => {
      const dead = Array.from({ length: 40 }, (_, index) => skill(`dead-${index}`, 'pack@market', 60));
      const ledger = buildLedger(
        resolveResult([], { skills: [...dead, skill('alive', 'pack@market', 60)], plugins: [plugin('pack@market')] }),
        measureResult([]),
        evidence(twelveSessions, [project({ skills: { 'pack:alive': { model: 5, user: 0 } } })]),
      );
      expect(notes(ledger)).toEqual([
        { kind: 'manual', command: null, why: expect.stringContaining('40 skills the model has never chosen come from') },
      ]);
      expect(ledger.findings[0].actions).toHaveLength(1);
    });

    it('says it once across both findings, and once for each plugin', () => {
      const ledger = buildLedger(
        resolveResult([], {
          skills: [
            skill('typed', 'pack@market'),
            skill('dead-one', 'pack@market'),
            skill('dead-two', 'pack@market'),
            skill('idle', 'other@market'),
            skill('busy', 'other@market'),
          ],
          plugins: [plugin('pack@market'), plugin('other@market')],
        }),
        measureResult([]),
        evidence(twelveSessions, [
          project({ slashCommands: { 'pack:typed': 9 }, skills: { 'other:busy': { model: 2, user: 0 } } }),
        ]),
      );
      // Two findings reach the pack plugin, typed-only and never-invoked, and it is still one line.
      expect(ledger.findings).toHaveLength(2);
      expect(notes(ledger).map((note) => note.why)).toEqual([
        expect.stringContaining('3 skills the model has never chosen come from the pack@market plugin'),
        expect.stringContaining('1 skill the model has never chosen comes from the other@market plugin'),
      ]);
    });

    it('🚨 does not tell you to set a plugin skill in skillOverrides', () => {
      const ledger = buildLedger(
        resolveResult([], {
          skills: [skill('mine', null), skill('dead', 'pack@market'), skill('alive', 'pack@market')],
          plugins: [plugin('pack@market')],
        }),
        measureResult([]),
        evidence(twelveSessions, [project({ skills: { 'pack:alive': { model: 5, user: 0 } } })]),
      );
      expect(ledger.findings[0].fix).toBe(
        'set your own to off in skillOverrides, or delete the ones you do not recognise; ' +
          'the ones from a plugin you use have no switch of their own',
      );
    });

    it('names the plugin switch when the whole plugin is idle', () => {
      const ledger = buildLedger(
        resolveResult([], { skills: [skill('dead', 'pack@market')], plugins: [plugin('pack@market')] }),
        measureResult([]),
        evidence(twelveSessions, [project()]),
      );
      expect(ledger.findings[0].fix).toBe('set "pack@market": false in enabledPlugins');
    });

    it('keeps the plain sentence when every skill is your own', () => {
      const ledger = buildLedger(
        resolveResult([], { skills: [skill('mine', null)] }),
        measureResult([]),
        evidence(twelveSessions, [project()]),
      );
      expect(ledger.findings[0].fix).toBe(
        'set each to off in skillOverrides, or delete the ones you do not recognise',
      );
    });
  });

  it('finds nothing to recover in a skill the model is already not told about', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [{ ...skill('silenced', null), override: 'off' as const }] }),
      measureResult([]),
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.findings).toEqual([]);
    expect(ledger.rows.find((row) => row.kind === 'skills')?.tokens).toBe(0);
  });
});

/* ---------------------------------------------------------------------------------------- */

describe('the denominator matches the blast radius of the fix', () => {
  /** Twelve more sessions, in a sibling checkout the fix would also reach. */
  const sibling = Array.from({ length: 12 }, (_, index) =>
    session({
      sessionId: `o${index}`,
      cwd: '/other',
      firstSeen: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }),
  );
  const userScope = server({
    scope: 'user',
    path: '/home/u/.claude.json',
    fixLever: {
      kind: 'claude-mcp-remove',
      command: 'claude mcp remove srv -s user',
      scope: 'user',
      path: '/home/u/.claude.json',
    },
  });
  const busyNextDoor = [
    project({ cwd: ROOT, mcpServers: {} }),
    project({ cwd: '/other', mcpServers: { srv: { calls: 200, sessions: 12, tools: { one: 200 } } } }),
  ];

  it('🚨 will not recommend a machine-wide removal for a server that is busy in another repo', () => {
    // The bug this whole change exists for, found on a real machine: one call in 152 sessions
    // here, 67 in a sibling repo, and `claude mcp remove -s user` printed against it. That command
    // is machine-wide, so a project-scoped silence can never justify it.
    const ledger = buildLedger(
      resolveResult([userScope]),
      measureResult([measured()]),
      evidence([...twelveSessions, ...sibling], busyNextDoor),
    );

    // Narrowed to the server-level finding on purpose. The per-tool prune finding legitimately
    // fires here \u2014 `two` really has never been called \u2014 and it recommends asking for a narrower
    // tool set, not running a machine-wide removal. Asserting on the substring alone caught it and
    // would have made this test pass for the wrong reason.
    expect(ledger.findings.some((finding) => finding.headline.startsWith('srv costs'))).toBe(false);
    expect(ledger.findings.some((finding) => finding.fix?.includes('claude mcp remove'))).toBe(false);
    const row = ledger.rows.find((entry) => entry.label === 'srv');
    expect(row?.calls).toBe(200);
    expect(row?.verdict.kind).toBe('earning-it');
  });

  it('says so on the row when it counted the whole machine', () => {
    const ledger = buildLedger(
      resolveResult([userScope]),
      measureResult([measured()]),
      evidence([...twelveSessions, ...sibling], busyNextDoor),
    );

    const verdict = ledger.rows.find((entry) => entry.label === 'srv')?.verdict;
    expect(verdict).toMatchObject({ kind: 'earning-it', scope: 'machine', sessions: 24 });
  });

  it('carries the scope into the finding, not only onto the row', () => {
    // The loud verdicts never reach `verdictLine`; they are rewritten as findings. A scope that
    // showed up on the table and not in the sentence recommending the fix would be worse than
    // useless, because the sentence is the part anybody acts on.
    const idleEverywhere = [project({ cwd: ROOT }), project({ cwd: '/other' })];
    const ledger = buildLedger(
      resolveResult([userScope]),
      measureResult([measured()]),
      evidence([...twelveSessions, ...sibling], idleEverywhere),
    );

    const finding = ledger.findings.find((entry) => entry.headline.startsWith('srv costs'));
    expect(finding?.detail).toContain('24 sessions on this machine');
  });

  it('keeps this project as the denominator when the fix only touches this project', () => {
    // Same sibling traffic, but `disabledMcpjsonServers` writes to this repo's settings and stops
    // the server here only. Silence here is then exactly the right evidence, and widening would
    // suppress a true finding.
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence([...twelveSessions, ...sibling], busyNextDoor),
    );

    const verdict = ledger.rows.find((entry) => entry.label === 'srv')?.verdict;
    expect(verdict).toMatchObject({ kind: 'never-called', scope: 'project', sessions: 12 });
  });
});

describe('a project with no history of its own', () => {
  const elsewhere = Array.from({ length: 12 }, (_, index) =>
    session({
      sessionId: `o${index}`,
      cwd: '/other',
      coldStartTokens: 90_000,
      firstSeen: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }),
  );

  const machineWide = server({
    scope: 'user',
    path: '/home/u/.claude.json',
    fixLever: {
      kind: 'claude-mcp-remove',
      command: 'claude mcp remove srv -s user',
      scope: 'user',
      path: '/home/u/.claude.json',
    },
  });

  it('\u{1f6a8} borrows the machine denominator for a server that was loaded in all of it', () => {
    // The most likely first run there is: a fresh clone, or any directory the reader has not used
    // Claude Code in. Every column that carries the argument \u2014 calls, per call \u2014 used to come out
    // empty while the history to fill them sat on the same disk. A `-s user` server was in context
    // for every one of those sessions, so a wider count is a wider window on the same question.
    const ledger = buildLedger(
      resolveResult([machineWide]),
      measureResult([measured()]),
      evidence(elsewhere, [
        project({ cwd: '/other', mcpServers: { srv: { calls: 4, sessions: 2, tools: { one: 4 } } } }),
      ]),
    );

    const row = ledger.rows.find((entry) => entry.label === 'srv');
    expect(row?.calls).toBe(4);
    expect(row?.perCall).not.toBeNull();
    expect(row?.verdict).toMatchObject({ scope: 'machine' });
    expect(ledger.judged).toBe(true);
  });

  /**
   * \u{1f6a8} The ceiling on the same rule, and the bug this exists to stop.
   *
   * Reproduced against the published `0.2.1`: a `.mcp.json` committed a year ago, in a directory
   * that had never run Claude Code, was reported as never called across every session on the
   * machine. It was in context for none of them. The window was real, and it was a window on
   * something else.
   */
  it('\u{1f6a8} will not borrow it for a server that exists only in this project', () => {
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(elsewhere, [
        project({ cwd: '/other', mcpServers: { srv: { calls: 4, sessions: 2, tools: { one: 4 } } } }),
      ]),
    );

    const row = ledger.rows.find((entry) => entry.label === 'srv');
    // Not 4: those calls were made where this `.mcp.json` is not loaded, by whatever `srv` names
    // over there. And not 0 either, which would be a measurement where there is no history to
    // measure. The column takes a dash, as `share` and `per call` already do.
    expect(row?.calls).toBeNull();
    expect(row?.verdict).toMatchObject({ kind: 'too-new', scope: 'project', sessions: 0 });
    expect(ledger.findings).toEqual([]);
  });

  it('\u{1f6a8} makes no never-called claim about a project server in a fresh clone', () => {
    // The age guard alone does not save this one: the `.mcp.json` was committed upstream years
    // before the clone existed, so `configuredSince` is genuinely old. Only reach saves it.
    const ledger = buildLedger(
      resolveResult([
        server({ configuredSince: { known: true, iso: '2024-01-01T00:00:00.000Z', commit: 'old', via: 'git' } }),
      ]),
      measureResult([measured()]),
      evidence(elsewhere, [project({ cwd: '/other' })]),
    );

    expect(ledger.findings).toEqual([]);
    expect(ledger.rows.find((entry) => entry.label === 'srv')?.verdict.kind).toBe('too-new');
    // And the screen must not read as an all-clear on the strength of it. Zero findings because
    // nothing could be judged is the opposite of zero findings because everything is used.
    expect(ledger.judged).toBe(false);
  });

  it('borrows it for a plugin the machine enabled, and not for one this repo enabled', () => {
    // A plugin switched on in `~/.claude/settings.json` is in context in every session on the
    // machine, so the wider denominator is honest. The same plugin switched on by this repo's own
    // settings file is in context nowhere else, and its silence elsewhere means nothing.
    const pluginServer = server({
      scope: 'plugin',
      plugin: 'pack@market',
      fixLever: {
        kind: 'enabledPlugins',
        plugin: 'pack@market',
        settingsPath: `${ROOT}/.claude/settings.local.json`,
      },
    });
    const config = (path: string, kind: 'user' | 'project-shared'): Partial<ResolvedConfig> => ({
      sources: [{ kind, path, present: true, keys: [] }],
      plugins: [
        { id: 'pack@market', enabled: true, enabledBy: path, installPath: null, scope: null, installedAt: null },
      ],
    });
    const history = evidence(elsewhere, [
      project({ cwd: '/other', mcpServers: { srv: { calls: 4, sessions: 2, tools: { one: 4 } } } }),
    ]);
    const scopeOf = (settings: Partial<ResolvedConfig>): unknown =>
      buildLedger(resolveResult([pluginServer], settings), measureResult([measured()]), history).rows.find(
        (entry) => entry.label === 'srv',
      )?.verdict;

    expect(scopeOf(config('/home/u/.claude/settings.json', 'user'))).toMatchObject({ scope: 'machine' });
    expect(scopeOf(config(`${ROOT}/.claude/settings.json`, 'project-shared'))).toMatchObject({ scope: 'project' });
  });

  const localSkill = (scope: 'user' | 'project') => ({
    name: 'dead',
    description: 'd',
    whenToUse: null,
    modelInvocable: true,
    scope,
    path: '/x',
    plugin: null,
    listingChars: 400,
    shadowedBy: null,
    override: null,
  });

  it('judges a skill the whole machine loads over the whole machine', () => {
    // `~/.claude/skills` is in context in every session on the machine, so the borrowed window is
    // a window on the same question, and the finding is allowed to stand on it.
    const ledger = buildLedger(
      resolveResult([], { skills: [localSkill('user')] }),
      measureResult([]),
      evidence(elsewhere, [project({ cwd: '/other' })]),
    );

    expect(ledger.findings[0].headline).toContain('never invoked');
    expect(ledger.findings[0].detail).toContain('12 sessions on this machine');
  });

  it('counts the calls it borrows, not only the sessions', () => {
    // The half that keeps widening honest in the other direction: a skill used in the sibling repo
    // is used, and a borrowed denominator that did not borrow the numerator would call it dead.
    const ledger = buildLedger(
      resolveResult([], { skills: [localSkill('user')] }),
      measureResult([]),
      evidence(elsewhere, [project({ cwd: '/other', skills: { dead: { model: 3, user: 0 } } })]),
    );

    expect(ledger.findings).toEqual([]);
  });

  it('🚨 says nothing about a skill that only exists in this project', () => {
    // `.claude/skills` here is in context nowhere else, so the machine's 12 sessions are not
    // evidence about it, and this directory has none of its own.
    const ledger = buildLedger(
      resolveResult([], { skills: [localSkill('project')] }),
      measureResult([]),
      evidence(elsewhere, [project({ cwd: '/other' })]),
    );

    expect(ledger.findings).toEqual([]);
  });

  it('🚨 does not borrow a total, because a cold start from another config is not this prefix', () => {
    // The denominator widens; the exact number never does. A median cold start taken across repos
    // with different servers and different memory files is not what a turn costs *here*, and
    // printing it under `EVERY TURN` would be the one number on the screen that is not exact.
    const ledger = buildLedger(
      resolveResult([server()]),
      measureResult([measured()]),
      evidence(elsewhere, [project({ cwd: '/other' })]),
    );

    expect(ledger.reconciliation.total).toBeNull();
    expect(ledger.reconciliation.unattributed).toBeNull();
  });
});

describe('the rows that count things', () => {
  it('counts to one in the singular', () => {
    // `1 memory files` shipped on the front screen of every project with a single CLAUDE.md.
    const skill = {
      name: 'one', description: 'd', whenToUse: null, modelInvocable: true, scope: 'project' as const,
      path: `${ROOT}/.claude/skills/one/SKILL.md`, plugin: null, listingChars: 40, shadowedBy: null, override: null,
    };
    const agent = {
      name: 'one', description: 'd', scope: 'project' as const, path: `${ROOT}/.claude/agents/one.md`,
      plugin: null, tools: null, listingChars: 40, shadowedBy: null,
    };
    const measure = measureResult([]);
    const ledger = buildLedger(
      resolveResult([], { skills: [skill], agents: [agent] }),
      { ...measure, memory: { items: 1, chars: 400, tokens: 100 } },
      evidence(twelveSessions, [project()]),
    );
    const labels = ledger.rows.map((row) => row.label);
    expect(labels).toContain('1 skill');
    expect(labels).toContain('1 agent');
    expect(labels).toContain('1 memory file');
  });

  it('still says the plural for everything else', () => {
    const ledger = buildLedger(
      resolveResult([]),
      { ...measureResult([]), memory: { items: 2, chars: 800, tokens: 200 } },
      evidence(twelveSessions, [project()]),
    );
    expect(ledger.rows.map((row) => row.label)).toContain('2 memory files');
  });
});

describe('the machine line', () => {
  it('counts subagent turns, which were billed, but not as sessions a human started', () => {
    const ledger = buildLedger(
      resolveResult([]),
      measureResult([]),
      evidence(
        [
          session({ turns: 100, contextTokens: 1_000 }),
          session({ sessionId: 'sub', kind: 'subagent', turns: 40, contextTokens: 400 }),
        ],
        [project({ slashCommands: { clear: 7, compact: 3, 'git-acp': 2 } })],
      ),
    );

    expect(ledger.machine).toEqual({
      sessions: 1,
      turns: 140,
      contextTokens: 1_400,
      clears: 7,
      compacts: 3,
    });
  });
});

/**
 * The floor the servers have had since `0.2.0`, which skills never got.
 *
 * `19 skills never invoked` on a machine two sessions old is not a finding, it is a description of
 * a machine two sessions old, and it arrives with a `--fix` that writes settings.
 */
describe('a machine too new to judge anything', () => {
  const newSkill = {
    name: 'dead',
    description: 'd',
    whenToUse: null,
    modelInvocable: true,
    scope: 'user' as const,
    path: '/x',
    plugin: null,
    listingChars: 400,
    shadowedBy: null,
    override: null,
  };
  const sessionsHere = (count: number): SessionEvidence[] =>
    Array.from({ length: count }, (_, index) =>
      session({ sessionId: `n${index}`, firstSeen: `2026-08-0${index + 1}T00:00:00.000Z` }),
    );

  it('🚨 will not call a skill unused on two sessions of evidence', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [newSkill] }),
      measureResult([]),
      evidence(sessionsHere(2), [project({ sessions: 2 })]),
    );

    expect(ledger.findings).toEqual([]);
  });

  it('still says so once there is enough history to say it', () => {
    const ledger = buildLedger(
      resolveResult([], { skills: [newSkill] }),
      measureResult([]),
      evidence(sessionsHere(5), [project({ sessions: 5 })]),
    );

    expect(ledger.findings[0].headline).toContain('never invoked');
    expect(ledger.findings[0].detail).toContain('5 sessions here');
  });
});

/* ---------------------------------------------------------------------------------------- */

/**
 * Rows read from what a session sent.
 *
 * 🔑 The guards in this block are the reason `0.4.0` exists. The packing model this replaces was
 * right about the formula and wrong about the window, on the machine it was written on, and nothing
 * in the suite could tell: every test fed the model its own assumption. Each case here puts a
 * record and a config side by side that **disagree**, so the only way to pass is to believe the
 * right one.
 */
describe('rows read from what a session sent', () => {
  const skillOf = (name: string, plugin: string | null, lineChars: number, override: 'name-only' | null = null) => {
    const listingName = plugin === null ? name : `${plugin.split('@')[0]}:${name}`;
    const description = 'd'.repeat(lineChars - listingName.length - 4);
    return {
      name,
      description,
      whenToUse: null,
      modelInvocable: true,
      scope: plugin === null ? ('user' as const) : ('plugin' as const),
      path: '/x',
      plugin,
      listingChars: name.length + 2 + description.length,
      shadowedBy: null,
      override,
    };
  };
  const plugin = (id: string) => ({
    id,
    enabled: true,
    enabledBy: '/home/.claude/settings.json',
    installPath: '/plugins/x',
    scope: 'user',
    installedAt: '2026-01-01T00:00:00.000Z',
  });
  const sent = (name: string, described: boolean, lineChars: number): SentSkill => ({
    name,
    described,
    chars: described ? lineChars : name.length + 2,
  });
  const record = (overrides: Partial<SentRecord> = {}): SentRecord => ({
    client: '2.1.300',
    asSent: true,
    skillListing: null,
    instructions: null,
    agents: null,
    toolList: null,
    servers: {},
    failedServers: [],
    hooks: null,
    sessionDetails: null,
    systemPrompt: null,
    builtinTools: null,
    ...overrides,
  });
  /** The newest of the twelve carries the record, the way the newest session on a machine does. */
  const withRecord = (sentRecord: SentRecord, at = 11): SessionEvidence[] =>
    twelveSessions.map((entry, index) => (index === at ? { ...entry, record: sentRecord } : entry));

  // Eighty plugin skills of 1,000 characters, one of your own, and one you set to `name-only`.
  const pack = Array.from({ length: 80 }, (_, index) => skillOf(`skill-${index}`, 'pack@market', 1_000));
  const onDisk = [skillOf('deploy-check', null, 400), skillOf('quiet', null, 300, 'name-only'), ...pack];
  // What the session recorded: twenty of the plugin's kept their description, sixty did not, yours
  // did not, and one skill the client ships with is there that no file accounts for.
  const listed: SentSkill[] = [
    sent('keybindings', true, 500),
    sent('deploy-check', false, 400),
    sent('quiet', false, 300),
    ...pack.map((_, index) => sent(`pack:skill-${index}`, index < 20, 1_000)),
  ];
  const listing = { chars: 30_086, listChars: 30_001, entries: listed.length, bare: 62, skills: listed };
  const usesThePack = project({ skills: { 'pack:skill-0': { model: 4, user: 0 } } });
  const build = (sentRecord: SentRecord, sessions = withRecord(sentRecord)) =>
    buildLedger(
      resolveResult([], { skills: onDisk, plugins: [plugin('pack@market')] }),
      measureResult([]),
      evidence(sessions, [usesThePack]),
    );
  const skillsRow = (ledger: ReturnType<typeof buildLedger>) => ledger.rows.find((row) => row.kind === 'skills');

  it('🚨 reads the session a person started, not the newer one a script did', () => {
    // `claude -p` is routinely run with settings nobody works under. Here a benchmark run, newest
    // on the machine, listed one skill. Read as "your session", it would report a listing of 10
    // tokens and hide sixty-one dropped descriptions behind it.
    const scripted = record({
      skillListing: { chars: 40, listChars: 40, entries: 1, bare: 0, skills: [sent('keybindings', true, 40)] },
    });
    const sessions = twelveSessions.map((entry, index) =>
      index === 11
        ? { ...entry, headless: true, record: scripted }
        : index === 10
          ? { ...entry, record: record({ skillListing: listing }) }
          : entry,
    );
    const ledger = build(scripted, sessions);
    expect(skillsRow(ledger)?.tokens).toBe(7_522);
    expect(ledger.source).toMatchObject({ kind: 'record', day: '2026-06-11' });
    expect(ledger.neverReceived?.dropped).toBe(61);
  });

  it('🚨 does not let scripted runs say what a turn costs here', () => {
    // Seven of the twelve are `claude -p` runs with every plugin switched off: 5,000 tokens each
    // where a working session opens at 50,000. Counted in, the median is the benchmark's.
    const mixed = twelveSessions.map((entry, index) =>
      index % 2 === 1 || index === 0 ? { ...entry, headless: true, coldStartTokens: 5_000 } : entry,
    );
    const ledger = buildLedger(resolveResult([]), measureResult([]), evidence(mixed, [project()]));
    expect(ledger.reconciliation.total).toBe(50_000);
    // With nobody at the keyboard in the whole history, a scripted run is what there is.
    const scriptedOnly = mixed.filter((entry) => entry.headless);
    const alone = buildLedger(resolveResult([]), measureResult([]), evidence(scriptedOnly, [project()]));
    expect(alone.reconciliation.total).toBe(5_000);
  });

  it('prefers the session a person started wherever the record is looked for', () => {
    // The ledger drops scripted sessions from its recent window before it looks, so through the
    // ledger this preference is hidden behind that one. It matters when the recent window holds no
    // record and the whole history is searched, which is this call.
    const scripted = record({
      skillListing: { chars: 40, listChars: 40, entries: 1, bare: 0, skills: [sent('keybindings', true, 40)] },
    });
    const script = session({ sessionId: 'script', headless: true, record: scripted, firstSeen: '2026-06-20T00:00:00.000Z' });
    const person = session({ sessionId: 'person', record: record({ skillListing: listing }) });
    expect(pickRecord([script, person])?.session.sessionId).toBe('person');
    // A scripted record still beats none at all.
    expect(pickRecord([script])?.session.sessionId).toBe('script');
    expect(pickRecord([session()])).toBeNull();
  });

  it('offers no fraction when even the whole window would not send every description', () => {
    // The setting stops at 1. A listing that needs more than the window is not fixed by a number,
    // and an offer of 1.2 is one the client refuses.
    const settings = { budgetFraction: null, maxDescChars: null, envBudgetChars: null };
    const listed = toListedSkills(onDisk, settings);
    const read = readSentListing(record({ skillListing: listing }), listed, settings);
    expect(read).not.toBeNull();
    if (read === null) return;
    expect(fractionToSendAll(read, settings)).toMatchObject({ fraction: expect.any(Number) });
    expect(fractionToSendAll({ ...read, uncappedChars: read.budget.chars * 120 }, settings)).toBeNull();
  });

  it('🚨 costs the skills row at what was sent, not at what the files would pack to', () => {
    const ledger = build(record({ skillListing: listing }));
    // 30,086 characters as sent. The model, left alone, would have packed these files into 8,000.
    expect(skillsRow(ledger)?.tokens).toBe(7_522);
    expect(skillsRow(ledger)?.label).toBe('83 skills');
    expect(skillsRow(ledger)?.verdict).toMatchObject({ why: expect.stringContaining('as sent in your session of 2026-06-12') });
    expect(ledger.source).toEqual({ kind: 'record', day: '2026-06-12', client: '2.1.300', asSent: true });
  });

  it('🚨 reads the budget, and the window behind it, back out of a listing that lost descriptions', () => {
    const ledger = build(record({ skillListing: listing }));
    // 30,001 characters pinned against a budget is a budget of 30,000: 1% of 750,000 tokens. A
    // model that knew only 200,000 and 1,000,000 printed 40,000 here and was wrong.
    expect(ledger.windowTokens).toBe(750_000);
    expect(skillsRow(ledger)?.verdict).toMatchObject({ why: expect.stringContaining('about 30,000 characters') });
    expect(skillsRow(ledger)?.verdict).toMatchObject({ why: expect.stringContaining('about 750,000 tokens') });
  });

  it('🚨 reads no budget, and no window, out of a list too small to have hit one', () => {
    // A 465-character list with one bare name whose skill is in no file. Read as a pinned list, it
    // derived "a window of about 12,000" and the first line said 292% of it. The smallest window
    // the client runs is 200,000 tokens, so no list under 8,000 characters was ever cut by the
    // default budget: the bare name is a skill with nothing to say, not one that lost something.
    const settings = { budgetFraction: null, maxDescChars: null, envBudgetChars: null };
    const small = {
      chars: 520,
      listChars: 465,
      entries: 4,
      bare: 1,
      skills: [sent('keybindings', true, 150), sent('release-notes', true, 150), sent('design-kit', true, 150), sent('mystery', false, 0)],
    };
    const read = readSentListing(record({ skillListing: small }), toListedSkills(onDisk, settings), settings);
    expect(read).not.toBeNull();
    if (read === null) return;
    expect(read.dropped).toEqual([]);
    expect(read.budget).toMatchObject({ basis: 'under', windowTokens: null });
    expect(read.uncappedIsFloor).toBe(false);
    expect(fractionToSendAll(read, settings)).toBeNull();

    // And the same list at 8,000 characters is a pinned one: the floor is the budget, not the count.
    const pinned = readSentListing(record({ skillListing: { ...small, listChars: 7_990, chars: 8_050 } }), toListedSkills(onDisk, settings), settings);
    expect(pinned?.dropped.map((skill) => skill.name)).toEqual(['mystery']);
    expect(pinned?.budget.basis).toBe('derived');
  });

  it('claims no window when every description was sent', () => {
    const everything = listed.map((skill) => ({ ...skill, described: true }));
    const ledger = build(record({ skillListing: { ...listing, bare: 0, skills: everything } }));
    expect(ledger.windowTokens).toBeNull();
    expect(ledger.neverReceived).toBeNull();
    expect(skillsRow(ledger)?.verdict).toMatchObject({ why: expect.stringContaining('every description included') });
    expect(ledger.findings.some((finding) => finding.headline.includes('name with no description'))).toBe(false);
  });

  it('takes the budget from the environment variable when that is what set it', () => {
    const ledger = buildLedger(
      resolveResult([], {
        skills: onDisk,
        plugins: [plugin('pack@market')],
        skillListing: { budgetFraction: null, maxDescChars: null, envBudgetChars: 30_000 },
      }),
      measureResult([]),
      evidence(withRecord(record({ skillListing: listing })), [usesThePack]),
    );
    // A budget set outright says nothing about the window, and the fraction is not the lever.
    expect(ledger.windowTokens).toBeNull();
    expect(ledger.listingBudget).toBeNull();
    expect(ledger.findings[0].fix).toContain('SLASH_COMMAND_TOOL_CHAR_BUDGET');
  });

  describe('what your agent never received', () => {
    it('is the first finding, counted by owner, and names the skills you wrote', () => {
      const ledger = build(record({ skillListing: listing }));
      const [first] = ledger.findings;
      expect(first.headline).toBe('61 of your 83 skills reach the model as a name with no description');
      expect(first.detail).toContain('pack 60 of 80');
      expect(first.detail).toContain('your own 1 of 2 (deploy-check)');
      expect(first.detail).toContain('From your session of 2026-06-12');
      expect(ledger.neverReceived).toEqual({ dropped: 61, listed: 83 });
    });

    it('does not count a skill you set to name-only as one that lost its description', () => {
      const ledger = build(record({ skillListing: listing }));
      // `quiet` went as a bare name because that is what its override asks for.
      expect(ledger.findings[0].detail).not.toContain('quiet');
    });

    it('prices the way out: the smallest fraction that sends everything, and what it adds', () => {
      const ledger = build(record({ skillListing: listing }));
      // 60 plugin descriptions of 983 and one of yours at 384, each with its `: `, on top of 30,001.
      expect(ledger.listingBudget).toEqual({
        fraction: 0.03,
        addsTokens: 14_872,
        atLeast: false,
        settingsPath: `${ROOT}/.claude/settings.local.json`,
      });
      expect(ledger.findings[0].fix).toContain('skillListingBudgetFraction to 0.03');
      expect(ledger.findings[0].fix).toContain('14,872 more tokens on every turn');
      expect(ledger.findings[0].fix).toContain('--restore-descriptions');
    });

    it('🚨 never puts the edit that costs tokens in the list fix runs by default', () => {
      const ledger = build(record({ skillListing: listing }));
      expect(ledger.findings[0].actions).toEqual([]);
      expect(ledger.findings[0].saves).toBeNull();
      expect(ledger.actions.some((action) => action.kind === 'listing-budget')).toBe(false);
    });

    it('says "at least" when a dropped skill is in no file and so could not be sized', () => {
      const unseen = [...listed, sent('vendor:mystery', false, 900)];
      const ledger = build(record({ skillListing: { ...listing, entries: unseen.length, bare: 63, skills: unseen } }));
      expect(ledger.listingBudget?.atLeast).toBe(true);
      expect(ledger.findings[0].fix).toContain('at least 0.03');
      expect(ledger.findings[0].detail).toContain('yours needs at least');
    });
  });

  describe('a server, as the session sent it', () => {
    const sentServers = (servers: SentRecord['servers'], failedServers: string[] = []) =>
      record({ toolList: { chars: 400, items: 20 }, servers, failedServers });

    it('🚨 charges a deferred server its tool names and instructions, not the probe', () => {
      const ledger = buildLedger(
        resolveResult([server({ name: 'ghost' })]),
        measureResult([measured({ name: 'ghost' })]),
        evidence(withRecord(sentServers({ ghost: { tools: 2, nameChars: 40, instructionChars: 400, schemaChars: 0 } })), [project()]),
      );
      // The probe says 1,000: name plus description for each tool. The client sent 440 characters.
      expect(ledger.rows[0].tokens).toBe(110);
      // Once, as the server your config declares, and not again as one "no file declares".
      expect(ledger.rows.filter((row) => row.kind === 'mcp-server')).toHaveLength(1);
      expect(ledger.findings[0].saves).toBe(110);
      expect(ledger.recoverable).toBe(110);
    });

    it('🚨 says nothing is recoverable from a server the session never connected', () => {
      const ledger = buildLedger(
        resolveResult([server({ name: 'ghost' })]),
        measureResult([measured({ name: 'ghost' })]),
        evidence(withRecord(sentServers({}, ['ghost'])), [project()]),
      );
      expect(ledger.rows[0].tokens).toBe(0);
      expect(ledger.rows[0].verdict).toMatchObject({
        kind: 'not-sent',
        reason: expect.stringContaining('could not connect in your session of 2026-06-12'),
      });
      // What it weighs when this tool starts it is still said, because it is the price of fixing it.
      expect(ledger.rows[0].verdict).toMatchObject({ reason: expect.stringContaining('Started here: 1,000 tokens') });
      expect(ledger.findings).toEqual([]);
      expect(ledger.recoverable).toBe(0);
    });

    it('keeps the probe for a server added after the session the record is from', () => {
      const ledger = buildLedger(
        resolveResult([
          server({ name: 'fresh', configuredSince: { known: true, iso: '2026-07-01T00:00:00.000Z', commit: 'a', via: 'git' } }),
        ]),
        measureResult([measured({ name: 'fresh' })]),
        evidence(withRecord(sentServers({})), [project()]),
      );
      // That session could not have sent it. Absence there is not evidence of anything.
      expect(ledger.rows[0].tokens).toBe(1_000);
      expect(ledger.rows[0].verdict.kind).toBe('too-new');
    });

    it('keeps the probe when the session recorded no tool list at all', () => {
      const ledger = buildLedger(
        resolveResult([server({ name: 'ghost' })]),
        measureResult([measured({ name: 'ghost' })]),
        evidence(withRecord(record({ skillListing: listing })), [project()]),
      );
      expect(ledger.rows[0].tokens).toBe(1_000);
    });

    it("🚨 finds a plugin server's calls under the name a transcript gives it", () => {
      const ledger = buildLedger(
        resolveResult(
          [
            server({
              name: 'db',
              plugin: 'kit@market',
              scope: 'plugin',
              fixLever: { kind: 'enabledPlugins', plugin: 'kit@market', settingsPath: `${ROOT}/.claude/settings.local.json` },
            }),
          ],
          { skills: [skillOf('unused', 'kit@market', 400)], plugins: [plugin('kit@market')] },
        ),
        measureResult([measured({ name: 'db' })]),
        evidence(twelveSessions, [project({ mcpServers: { plugin_kit_db: { calls: 30, sessions: 9, tools: { one: 30 } } } })]),
      );
      expect(ledger.rows[0].calls).toBe(30);
      // Thirty calls means the plugin is in use, so nothing may offer to switch the whole of it off.
      expect(ledger.actions.some((action) => action.kind === 'disable-plugin')).toBe(false);
    });

    it('gives a server no file declares a row, and a finding when it is barely used', () => {
      const ledger = buildLedger(
        resolveResult([]),
        measureResult([]),
        evidence(
          withRecord(
            sentServers({
              claude_ai_Big: { tools: 70, nameChars: 4_000, instructionChars: 800, schemaChars: 0 },
              claude_ai_Tiny: { tools: 1, nameChars: 80, instructionChars: 0, schemaChars: 0 },
            }),
          ),
          [project({ mcpServers: { claude_ai_Big: { calls: 1, sessions: 1, tools: { x: 1 } } } })],
        ),
      );
      const big = ledger.rows.find((row) => row.label === 'claude_ai_Big');
      expect(big).toMatchObject({ tokens: 1_200, calls: 1, verdict: { kind: 'rarely-called', scope: 'machine', window: 'on record' } });
      const finding = ledger.findings.find((one) => one.headline.startsWith('claude_ai_Big'));
      expect(finding?.saves).toBe(1_200);
      // Nothing of ours to edit, so it is handed back and never written.
      expect(finding?.actions).toEqual([expect.objectContaining({ kind: 'manual', command: null })]);
      // Twenty tokens is not a row. The small ones share one, and it says how many it stands for.
      expect(ledger.rows.find((row) => row.label === '1 small connector')).toMatchObject({ tokens: 20, count: 1 });
    });
  });

  it('itemises what Claude Code sends on its own account, out of what used to be unattributed', () => {
    const ledger = buildLedger(
      resolveResult([]),
      measureResult([]),
      evidence(
        withRecord(
          record({
            builtinTools: { chars: 96_000, items: 14 },
            systemPrompt: { chars: 12_000, items: 14 },
            toolList: { chars: 1_600, items: 24 },
            sessionDetails: { chars: 2_800, items: 6 },
            hooks: { chars: 2_000, items: 2 },
            agents: { chars: 19_200, items: 23 },
            instructions: { chars: 24_000, files: [{ path: '/repo/CLAUDE.md', chars: 23_000 }] },
          }),
        ),
        [project()],
      ),
    );
    const byPart = (part: string) => ledger.rows.find((row) => row.part === part);
    expect(byPart('tools')).toMatchObject({ kind: 'client', tokens: 24_000, count: 14, label: 'its 14 tools' });
    expect(byPart('system-prompt')?.tokens).toBe(3_000);
    expect(ledger.rows.find((row) => row.kind === 'hooks')?.tokens).toBe(500);
    // The agents the client ships with are in the record and in no file.
    expect(ledger.rows.find((row) => row.kind === 'agents')).toMatchObject({ tokens: 4_800, label: '23 agents' });
    expect(ledger.rows.find((row) => row.kind === 'memory')).toMatchObject({ tokens: 6_000, label: '1 memory file' });
    // 50,000 billed, 39,400 of it now has a name.
    expect(ledger.reconciliation.unattributed).toBe(50_000 - 39_400);
  });

  it('🚨 does not let a session a script started speak for what your agent is sent', () => {
    const scripted = record({ skillListing: { ...listing, chars: 400, listChars: 380, entries: 3, bare: 0, skills: listed.slice(0, 3).map((one) => ({ ...one, described: true })) } });
    const sessions = twelveSessions.map((entry, index) =>
      index === 11 ? { ...entry, headless: true, record: scripted } : index === 10 ? { ...entry, record: record({ skillListing: listing }) } : entry,
    );
    const ledger = build(scripted, sessions);
    expect(ledger.source).toMatchObject({ kind: 'record', day: '2026-06-11' });
    expect(skillsRow(ledger)?.tokens).toBe(7_522);
  });
});
