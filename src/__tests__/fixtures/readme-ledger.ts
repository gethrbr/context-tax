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
 */

import type { Ledger } from '../../ledger/types.js';

const SETTINGS = '~/projects/storefront/.claude/settings.local.json';

/** Sessions and turns, quoted in the rows, the findings and the machine line alike. */
const SESSIONS = 96;
const TURNS = 42_900;

export function readmeLedger(): Ledger {
  return {
    cwd: '~/projects/storefront',
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
      attributed: 8_800,
      unattributed: 31_200,
      overAttributed: false,
    },
    rows: [
      {
        label: 'figma',
        kind: 'mcp-server',
        tokens: 800,
        loadedTokens: 1_410,
        share: 0.02,
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
        tokens: 1_200,
        loadedTokens: 4_380,
        share: 0.03,
        calls: 214,
        perCall: 241_000,
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
        tokens: 800,
        loadedTokens: 2_840,
        share: 0.02,
        calls: 3,
        perCall: 11_440_000,
        basis: null,
        // Machine-scoped, because `claude mcp remove -s user` is machine-wide and a project's
        // silence can never justify a command that reaches every project.
        verdict: {
          kind: 'rarely-called',
          calls: 3,
          sessions: SESSIONS,
          perCall: 11_440_000,
          window: 'since it was configured',
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
        tokens: 800,
        loadedTokens: 6_700,
        share: 0.02,
        calls: 1,
        perCall: 34_320_000,
        basis: null,
        verdict: {
          kind: 'rarely-called',
          calls: 1,
          sessions: SESSIONS,
          perCall: 34_320_000,
          window: 'since it was configured',
          scope: 'project',
        },
        fix: `add "sentry" to disabledMcpjsonServers in ${SETTINGS}`,
      },
      {
        label: '14 skills',
        kind: 'skills',
        tokens: 1_200,
        loadedTokens: null,
        share: 0.03,
        calls: 1,
        perCall: null,
        basis: null,
        verdict: {
          kind: 'not-attributable',
          why: 'a skill listing is one line each; the useful unit is the skill, below',
        },
        fix: null,
      },
      {
        label: '11 agents',
        kind: 'agents',
        tokens: 2_400,
        loadedTokens: null,
        share: 0.06,
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
        tokens: 1_600,
        loadedTokens: null,
        share: 0.04,
        calls: null,
        perCall: null,
        basis: null,
        verdict: {
          kind: 'not-attributable',
          why: 'the model reads these, it does not call them, so no log can say which lines were used',
        },
        fix: null,
      },
    ],
    findings: [
      {
        headline: 'figma costs 800 tokens every turn and has never been called',
        detail:
          `0 calls in ${SESSIONS} sessions since it was configured. Loading its schemas costs 610 ` +
          'tokens more, every time something does.',
        saves: 800,
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
          `800 tokens re-sent across ${TURNS.toLocaleString('en-US')} turns for 3 calls: 11,440,000 ` +
          'tokens of standing cost per use. Loading its schemas costs 2,040 tokens more, every time ' +
          'something does.',
        saves: 800,
        fix: 'claude mcp remove linear -s user',
        actions: [],
      },
      {
        headline: `sentry is loaded on every turn and used in 1 of ${SESSIONS} sessions`,
        detail:
          `800 tokens re-sent across ${TURNS.toLocaleString('en-US')} turns for 1 call: 34,320,000 ` +
          'tokens of standing cost per use. Loading its schemas costs 5,900 tokens more, every time ' +
          'something does.',
        saves: 800,
        fix: `add "sentry" to disabledMcpjsonServers in ${SETTINGS}`,
        actions: [],
      },
      {
        headline: '13 skills never invoked, either way',
        detail: 'changelog-writer, commit-helper, design-review, ...',
        saves: null,
        fix: 'set each to off in skillOverrides, or delete the ones you do not recognise',
        actions: [],
      },
    ],
    recoverable: 2_400,
    problems: [],
  };
}
