/**
 * The invented machine the README's screens are drawn from.
 *
 * 🔒 **Every name and number here is fabricated.** No part of it comes from anybody's real config.
 * That is a hard rule rather than a preference: a real run carries absolute home directories,
 * private server names and the session history of whoever ran it, and a screenshot of one in a
 * public README publishes all three at once.
 *
 * It lives under `__tests__` so it never ships in the package, and it is a `Ledger` literal rather
 * than a config to resolve and measure, because the README documents *the screen* — what the
 * renderer does with a ledger — and going through the other two passes would only add ways for the
 * fixture to fail for reasons the README is not about.
 *
 * 🔑 The story is internally coherent and it has to stay that way. One project, which is therefore
 * also the whole machine; 96 sessions and 42,900 turns everywhere they appear; and `linear`, whose
 * only lever is the machine-wide `claude mcp remove -s user`, carries a machine-scoped verdict
 * because that is the rule the tool now enforces.
 *
 * The rows are the ones a session **recorded**, which is what a current Claude Code gives the tool
 * to read: a server costs its tool names and instructions, the client's own tools and prompt have
 * rows of their own, and nine skills reached the model with their description taken away. The
 * arithmetic holds on purpose. 40,000 is 20% of 200,000; 8,000 characters is 1% of that window;
 * 11,640 characters needs a fraction of 0.015 and adds 910 tokens; every per-call figure is its
 * row times 42,900 turns over its calls; and the rows plus `unattributed` make the total.
 */

import type { Ledger } from '../../ledger/types.js';

const SETTINGS = '~/projects/storefront/.claude/settings.local.json';

/** Sessions and turns, quoted in the rows, the findings and the machine line alike. */
const SESSIONS = 96;
const TURNS = 42_900;

export function readmeLedger(): Ledger {
  const itsOwn = 'sent by Claude Code itself on every turn, so there is nothing here to switch off';
  const notionFix =
    'no file here declares it, so there is nothing for this tool to edit. /mcp in a session shows where it ' +
    'is connected from, and a claude.ai connector is switched off in your claude.ai settings';
  return {
    cwd: '~/projects/storefront',
    source: { kind: 'record', day: '2026-09-01', client: '2.1.300', asSent: true },
    windowTokens: 200_000,
    listingBudget: { fraction: 0.015, addsTokens: 910, atLeast: false, settingsPath: SETTINGS },
    neverReceived: { dropped: 9, listed: 31 },
    actions: [],
    judged: true,
    machine: {
      sessions: SESSIONS,
      turns: TURNS,
      // 42,900 turns at the 40,000-token prefix below. Kept consistent so a reader who multiplies
      // the two numbers on the screen gets the third.
      contextTokens: TURNS * 40_000,
      clears: 118,
      compacts: 31,
    },
    reconciliation: {
      total: 40_000,
      window: `10 most recent sessions, 2026-08-24 to 2026-09-01`,
      sessions: SESSIONS,
      attributed: 35_200,
      unattributed: 4_800,
      overAttributed: false,
    },
    rows: [
      {
        label: 'figma',
        kind: 'mcp-server',
        tokens: 300,
        loadedTokens: 1_410,
        share: 300 / 40_000,
        calls: 0,
        perCall: null,
        basis: null,
        verdict: {
          kind: 'never-called',
          sessions: SESSIONS,
          window: 'since it was configured',
          scope: 'project',
        },
        fix: `add "figma" to disabledMcpjsonServers in ${SETTINGS}`,
      },
      {
        label: 'github',
        kind: 'mcp-server',
        tokens: 700,
        loadedTokens: 4_380,
        share: 700 / 40_000,
        calls: 214,
        perCall: 140_327,
        basis: null,
        verdict: {
          kind: 'earning-it',
          calls: 214,
          sessions: SESSIONS,
          window: 'since it was configured',
          scope: 'project',
        },
        fix: `add "github" to disabledMcpjsonServers in ${SETTINGS}`,
      },
      {
        label: 'linear',
        kind: 'mcp-server',
        tokens: 300,
        loadedTokens: 2_840,
        share: 300 / 40_000,
        calls: 3,
        perCall: 4_290_000,
        basis: null,
        // Machine-scoped, because `claude mcp remove -s user` is machine-wide and a project's
        // silence can never justify a command that reaches every project. And `on record`, not
        // `since it was configured`: a `~/.claude.json` server has no git history to date it by,
        // and the ledger says so rather than pretending to know.
        verdict: {
          kind: 'rarely-called',
          calls: 3,
          sessions: SESSIONS,
          perCall: 4_290_000,
          window: 'on record',
          scope: 'machine',
        },
        fix: 'claude mcp remove linear -s user',
      },
      {
        label: 'postgres',
        kind: 'mcp-server',
        tokens: null,
        loadedTokens: null,
        share: null,
        calls: 0,
        perCall: null,
        basis: null,
        verdict: {
          kind: 'not-measured',
          reason: 'configured but off, so nothing was started to measure',
        },
        fix: null,
      },
      {
        label: 'sentry',
        kind: 'mcp-server',
        tokens: 400,
        loadedTokens: 6_700,
        share: 400 / 40_000,
        calls: 1,
        perCall: 17_160_000,
        basis: null,
        verdict: {
          kind: 'rarely-called',
          calls: 1,
          sessions: SESSIONS,
          perCall: 17_160_000,
          window: 'since it was configured',
          scope: 'project',
        },
        fix: `add "sentry" to disabledMcpjsonServers in ${SETTINGS}`,
      },
      {
        // In no file on the machine: a connector attached to the claude.ai account. Only a session
        // record can show it, which is why it is in the story.
        label: 'claude_ai_Notion',
        kind: 'mcp-server',
        tokens: 900,
        loadedTokens: null,
        share: 900 / 40_000,
        calls: 2,
        perCall: 19_305_000,
        basis: null,
        verdict: {
          kind: 'rarely-called',
          calls: 2,
          sessions: SESSIONS,
          perCall: 19_305_000,
          window: 'on record',
          scope: 'machine',
        },
        fix: notionFix,
      },
      {
        label: '31 skills',
        kind: 'skills',
        count: 31,
        tokens: 2_000,
        loadedTokens: null,
        share: 2_000 / 40_000,
        calls: 1,
        perCall: null,
        basis: null,
        verdict: {
          kind: 'not-attributable',
          why:
            'as sent in your session of 2026-09-01: 9 skills went as a name with no description, because ' +
            'Claude Code caps this listing at about 8,000 characters, its share of a window of about ' +
            '200,000 tokens',
        },
        fix: null,
      },
      {
        label: '11 agents',
        kind: 'agents',
        count: 11,
        tokens: 2_400,
        loadedTokens: null,
        share: 2_400 / 40_000,
        calls: null,
        perCall: null,
        basis: null,
        verdict: {
          kind: 'not-attributable',
          why: 'agent listings are not separable from the prompt',
        },
        fix: null,
      },
      {
        label: '2 memory files',
        kind: 'memory',
        count: 2,
        tokens: 1_600,
        loadedTokens: null,
        share: 1_600 / 40_000,
        calls: null,
        perCall: null,
        basis: null,
        verdict: {
          kind: 'not-attributable',
          why: 'the model reads these, it does not call them, so no log can say which lines were used',
        },
        fix: null,
      },
      {
        label: 'your hooks',
        kind: 'hooks',
        tokens: 400,
        loadedTokens: null,
        share: 400 / 40_000,
        calls: null,
        perCall: null,
        basis: null,
        verdict: {
          kind: 'not-attributable',
          why:
            'what your hooks put in front of the first turn. A hook that adds context on every prompt ' +
            'adds this much again each time',
        },
        fix: null,
      },
      ...(
        [
          ['its 14 tools', 'tools', 22_000, 14],
          ['its system prompt', 'system-prompt', 3_200, undefined],
          ['its tool name list', 'tool-list', 400, undefined],
          ['its session details', 'session-details', 600, undefined],
        ] as const
      ).map(([label, part, tokens, count]) => ({
        label,
        kind: 'client' as const,
        part,
        ...(count === undefined ? {} : { count }),
        tokens,
        loadedTokens: null,
        share: tokens / 40_000,
        calls: null,
        perCall: null,
        basis: null,
        verdict: { kind: 'not-attributable' as const, why: itsOwn },
        fix: null,
      })),
    ],
    findings: [
      {
        headline: '9 of your 31 skills reach the model as a name with no description',
        detail:
          'design-kit 7 of 12, your own 2 of 14 (release-notes, db-migrate). A bare name gives the model ' +
          'nothing to choose a skill by. The cap is about 8,000 characters and yours needs about 11,640. ' +
          'From your session of 2026-09-01; who loses out shifts with recent use.',
        saves: null,
        fix:
          'set skillListingBudgetFraction to 0.015 and every description is sent, for about 910 more tokens ' +
          'on every turn (context-tax fix --restore-descriptions writes it). Or make room: each skill ' +
          'switched off below hands its space to another description',
        actions: [],
      },
      {
        headline: 'figma costs 300 tokens every turn and has never been called',
        detail:
          `0 calls in ${SESSIONS} sessions since it was configured. Loading its schemas costs 1,110 ` +
          'tokens more, every time something does.',
        saves: 300,
        fix: `add "figma" to disabledMcpjsonServers in ${SETTINGS}`,
        actions: [],
      },
      {
        headline: 'github: 9 of its 26 tools have never been called',
        detail:
          'create_gist, delete_file, fork_repo, list_gists, ... Their names and descriptions cost ' +
          '415 tokens on every turn, and 1,102 tokens of schema you have never used waits behind them.',
        saves: null,
        fix: 'MCP has no per-tool switch. Ask the server for a narrower tool set, or drop the server.',
        actions: [],
      },
      {
        headline: `linear is loaded on every turn and used in 3 of ${SESSIONS} sessions on this machine`,
        detail:
          `300 tokens re-sent across ${TURNS.toLocaleString('en-US')} turns for 3 calls: 4,290,000 ` +
          'tokens of standing cost per use, counted over every session on record because nothing says ' +
          'when this was added, so read it as an upper bound. Loading its schemas costs 2,540 tokens ' +
          'more, every time something does.',
        saves: 300,
        fix: 'claude mcp remove linear -s user',
        actions: [],
      },
      {
        headline: `sentry is loaded on every turn and used in 1 of ${SESSIONS} sessions`,
        detail:
          `400 tokens re-sent across ${TURNS.toLocaleString('en-US')} turns for 1 call: 17,160,000 ` +
          'tokens of standing cost per use. Loading its schemas costs 6,300 tokens more, every time ' +
          'something does.',
        saves: 400,
        fix: `add "sentry" to disabledMcpjsonServers in ${SETTINGS}`,
        actions: [],
      },
      {
        headline: `claude_ai_Notion is sent on every turn and used in 2 of ${SESSIONS} sessions on this machine`,
        detail:
          `900 tokens of tool names and instructions across ${TURNS.toLocaleString('en-US')} turns for 2 ` +
          'calls. No file on this machine declares it, so its age is unknown and the per-call figure is ' +
          'an upper bound.',
        saves: 900,
        fix: notionFix,
        actions: [],
      },
      {
        headline: '13 skills never invoked, either way',
        // The real ledger opens with this whenever a listing dropped descriptions, and this one did.
        detail:
          'The listing is over its budget, so most of what this frees goes to another description rather than out of the prompt. changelog-writer, commit-helper, db-migrate, ...',
        saves: null,
        fix: 'set each to off in skillOverrides, or delete the ones you do not recognise',
        actions: [],
      },
    ],
    recoverable: 1_900,
    problems: [],
  };
}
