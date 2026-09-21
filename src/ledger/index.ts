/**
 * Cost times usage, joined.
 *
 * Everything before this file is a list. This is the multiplication, and the multiplication is the
 * product: nothing else on the machine can say *you pay 4,139 tokens for this on every turn and
 * you have not called it in 41 sessions.*
 *
 * Two rules run through all of it:
 *
 *  1. **No claim of dead weight without its denominator.** `never-called` cannot be constructed
 *     without a session count and a window, and a server whose age is unknown gets a verdict that
 *     hands the judgement back to the reader rather than one that guesses for them.
 *  2. **The total is exact and the rows are not.** The total comes from `usage`, so the rows are
 *     reconciled against it and the difference is printed as `unattributed`. If the rows exceed
 *     it, that is said out loud instead of being absorbed.
 */

import { transcriptKeysFor } from '../evidence/names.js';
import type { Evidence, ProjectEvidence, SentServer, SessionEvidence } from '../evidence/types.js';
import { actionKey } from '../fix/types.js';
import type { FixAction } from '../fix/types.js';
import {
  apportion,
  inferContextWindow,
  lineChars,
  packSkillListing,
  savedBy,
  skillKey,
  skillListingBudgetChars,
  toListedSkills,
} from '../measure/skill-listing.js';
import { tokens as toTokens } from '../measure/tokens.js';
import type { MeasureResult, MeasuredMcpServer } from '../measure/types.js';
import type {
  ConfiguredSince,
  ResolveResult,
  ResolvedMcpServer,
  ResolvedSkill,
  SkillOverride,
} from '../resolve/types.js';
import { serverReach, skillReach } from './reach.js';
import { fractionToSendAll, ownerOf, pickRecord, readSentListing } from './sent.js';
import type {
  ClientPart,
  EvidenceScope,
  Finding,
  Ledger,
  LedgerRow,
  ListingBudgetOffer,
  MachineEvidence,
  Verdict,
} from './types.js';

export interface LedgerOptions {
  /**
   * How many recent sessions the exact total is taken from.
   *
   * Recent, not all, because the total has to describe the config you have now. A median across
   * two years of sessions describes a config that no longer exists.
   */
  window?: number;
  /**
   * Sessions since a thing was configured before silence means anything.
   *
   * Below this, the verdict is `too-new`. Zero calls in two sessions is not evidence of anything,
   * and reporting it as such is precisely how a tool loses the reader.
   */
  minSessions?: number;
}

const DEFAULT_WINDOW = 10;
const DEFAULT_MIN_SESSIONS = 5;

/**
 * Calls per session below which a server is loaded far more often than it is used.
 *
 * One in ten is the line between "occasionally handy" and "you are paying for this on every turn
 * of every session to use it in one". It exists because a rule that only fired at exactly zero
 * would miss the most expensive row on this machine: a server with a single call across 115
 * sessions, whose schema is re-sent on all of them.
 */
const RARELY_CALLED = 0.1;

/** Below this, a server this tool cannot edit is not worth a row of its own. */
const SMALL_SERVER = 100;

/**
 * `1 memory files` was on the screen of every run in a directory with one CLAUDE.md.
 *
 * It is a small thing that does a large thing: a reader deciding whether to believe an estimate
 * reads the sentence around it first, and a number the tool cannot count to one is not a number
 * anybody trusts to 40,000.
 */
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** One slice of the scan, rolled up. Built twice: this tree, and the whole machine. */
interface Usage {
  calls: Map<string, number>;
  toolCalls: Map<string, Map<string, number>>;
  skillModelCalls: Map<string, number>;
  skillTypedCalls: Map<string, number>;
  agentCalls: Map<string, number>;
}


function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

/** `cwd` itself, or anything beneath it. Running from a package still means the whole repo. */
function under(path: string | null, root: string): boolean {
  return path !== null && (path === root || path.startsWith(`${root}/`));
}

function startedSince(sessions: SessionEvidence[], since: ConfiguredSince): SessionEvidence[] | null {
  if (!since.known) return null;
  const at = Date.parse(since.iso);
  if (Number.isNaN(at)) return null;
  return sessions.filter((session) => session.firstSeen !== null && Date.parse(session.firstSeen) >= at);
}

/**
 * Main-loop turns, which is what a per-turn cost has to be multiplied by.
 *
 * ⚠️ Subagent turns are excluded deliberately: they are billed, but they carry a *different*
 * prefix, so multiplying this prefix by them would invent cost that was never charged.
 */
function turnsIn(sessions: SessionEvidence[]): number {
  return sessions.reduce((sum, session) => sum + session.turns - session.sidechainTurns, 0);
}

/**
 * Calls recorded for something that can be named two ways.
 *
 * 🚨 The `Skill` tool's `skill` argument and the `Task` tool's `subagent_type` accept a bare name
 * **and** a `plugin:name` form, and this machine's transcripts hold both for the same skill —
 * `frontend-design` four times and `frontend-design:frontend-design` twice. Matching only the bare
 * name loses the prefixed calls, which turns something you use into a `never invoked` finding. That
 * was survivable while the tool only printed; with `--fix` behind it, it is a write that switches
 * off a skill somebody uses.
 *
 * When two plugins ship the same skill name, both get credit for the bare-name calls. That
 * over-counts use, which is the safe direction: it can only make this tool leave something alone.
 */
function callsFor(counts: Map<string, number>, name: string, plugin: string | null): number {
  const bare = counts.get(name) ?? 0;
  if (plugin === null) return bare;
  return bare + (counts.get(`${plugin.split('@')[0]}:${name}`) ?? 0);
}

/**
 * Calls recorded for a server, under every name a transcript can give it.
 *
 * 🚨 A plugin's server is declared `acme` and its tools are recorded `mcp__plugin_acme_acme__*`, and
 * a server declared `my.server` is recorded `my_server`. Looking up the declared name alone found
 * nothing for either, which reads as a server nobody calls, and an unused plugin server is one of
 * the things that lets the whole plugin be switched off.
 */
function serverCalls(counts: Map<string, number>, name: string, plugin: string | null): number {
  return transcriptKeysFor(name, plugin).reduce((sum, key) => sum + (counts.get(key) ?? 0), 0);
}

function serverToolCalls(
  counts: Map<string, Map<string, number>>,
  name: string,
  plugin: string | null,
): Map<string, number> {
  const merged = new Map<string, number>();
  for (const key of transcriptKeysFor(name, plugin)) {
    for (const [tool, calls] of counts.get(key) ?? []) merged.set(tool, (merged.get(tool) ?? 0) + calls);
  }
  return merged;
}

/**
 * Merge actions that arrive at the same edit.
 *
 * Several findings can land on one lever: an idle plugin's server and each of its unused skills all
 * point at the same `enabledPlugins` entry. Saves are **summed** rather than replaced, because one
 * edit does recover all of them — the server's schema and every listing line the plugin adds.
 */
function mergeActions(actions: FixAction[]): FixAction[] {
  const out: FixAction[] = [];
  const seen = new Map<string, number>();
  for (const action of actions) {
    const key = actionKey(action);
    const at = seen.get(key);
    if (at === undefined) {
      seen.set(key, out.length);
      out.push(action);
      continue;
    }
    const first = out[at];
    if (first.kind === 'manual' || action.kind === 'manual') continue;
    out[at] =
      first.saves === null && action.saves === null
        ? first
        : { ...first, saves: (first.saves ?? 0) + (action.saves ?? 0) };
  }
  return out;
}

/**
 * How a server would be turned off, given where it was declared.
 *
 * Four origins, four different levers, and picking the wrong one produces advice that silently
 * does nothing: `disabledMcpjsonServers` has no effect on a server that came from `~/.claude.json`,
 * and a `skillOverrides` entry has no effect on a skill that came from a plugin.
 */
function fixFor(server: ResolvedMcpServer): string {
  switch (server.fixLever.kind) {
    case 'disabledMcpjsonServers':
      return `add "${server.name}" to disabledMcpjsonServers in ${server.fixLever.settingsPath}`;
    case 'claude-mcp-remove':
      return server.fixLever.command;
    case 'enabledPlugins':
      return `set "${server.fixLever.plugin}": false in enabledPlugins, in ${server.fixLever.settingsPath}`;
    case 'none':
      return server.fixLever.why;
  }
}

/**
 * The same four levers as `fixFor`, as something `--fix` can execute.
 *
 * 🔒 `claude-mcp-remove` stays a `manual` action on purpose. It is the `~/.claude.json` lever, and
 * that file holds live API keys and bearer tokens: this tool will not rewrite it and will not back
 * it up, because the backup would be a second copy of every credential on the machine. The command
 * is handed to the reader instead, scoped, so it does the right thing when a name exists twice.
 */
function serverActions(
  server: ResolvedMcpServer,
  saves: number | null,
  why: string,
  idle: (plugin: string) => boolean,
): FixAction[] {
  switch (server.fixLever.kind) {
    case 'disabledMcpjsonServers':
      return [
        {
          kind: 'disable-mcpjson-server',
          server: server.name,
          settingsPath: server.fixLever.settingsPath,
          why,
          saves,
        },
      ];
    case 'claude-mcp-remove':
      return [{ kind: 'manual', command: server.fixLever.command, why }];
    case 'enabledPlugins': {
      const { plugin, settingsPath } = server.fixLever;
      // ⚠️ A plugin is all-or-nothing. Switching one off to drop an unused server would take its
      // skills, agents and commands with it, so it is only ever proposed when nothing the plugin
      // provides has been used. Otherwise the honest answer is that there is no lever.
      if (!idle(plugin)) {
        return [
          {
            kind: 'manual',
            command: null,
            why:
              `${why} The only switch is the whole ${plugin} plugin, and you do use other things ` +
              'it provides, so there is nothing safe to turn off here.',
          },
        ];
      }
      return [{ kind: 'disable-plugin', plugin, settingsPath, why, saves }];
    }
    case 'none':
      return [];
  }
}

function skillLabel(skill: { name: string; plugin: string | null }): string {
  return skill.plugin === null ? skill.name : `${skill.plugin.split('@')[0]}:${skill.name}`;
}

/**
 * Names for a list of skills, with collisions widened until they are actually distinct.
 *
 * 🔑 This machine has `frontend-design` twice, from two different marketplaces, under a plugin of
 * the same name. Prefixing with the plugin is not enough: it produces `frontend-design:frontend-
 * design` twice, and a list that repeats itself reads as a bug in the tool rather than as the
 * duplication it is reporting. The marketplace is the part that differs, so it is added only where
 * it has to be.
 */
function skillLabels(skills: { name: string; plugin: string | null }[]): string[] {
  const base = skills.map(skillLabel);
  const counts = new Map<string, number>();
  for (const label of base) counts.set(label, (counts.get(label) ?? 0) + 1);
  return skills.map((skill, index) =>
    (counts.get(base[index]) ?? 0) > 1 && skill.plugin !== null
      ? `${skill.plugin}:${skill.name}`
      : base[index],
  );
}

/**
 * Why a row's number did not come from this machine, in the words `measure` already uses.
 *
 * The fallback table is a real measurement of a real server, taken elsewhere and shipped with the
 * package. It is not the same claim as "we started your copy and weighed it", and until now the
 * main screen printed both as a bare number with nothing to tell them apart.
 */
/** The scope suffix used in every finding, matching the one the renderer uses on the table. */
const where = (scope: EvidenceScope): string => (scope === 'machine' ? ' on this machine' : '');

function basisFor(measured: MeasuredMcpServer): string | null {
  return measured.status.kind === 'estimated'
    ? `from the bundled table (${measured.status.source}), not your machine`
    : null;
}

function serverVerdict(
  measured: MeasuredMcpServer,
  calls: number,
  perCall: number | null,
  sessionsSince: number | null,
  since: ConfiguredSince,
  windowSessions: number,
  minSessions: number,
  scope: EvidenceScope,
): Verdict {
  if (measured.status.kind === 'unmeasured') {
    if (measured.status.cause !== 'failed') return { kind: 'not-measured', reason: measured.status.reason };
    // 🚨 `failed` means *this tool* could not start it, and that is only a verdict about your
    // sessions when they agree. A remote server behind a login is the common case: the client holds
    // the token, this tool does not, the probe gets a 401, and the transcripts show the server
    // answering calls all week. Calling that one broken is the tool's failure printed as yours.
    if (calls > 0) {
      return {
        kind: 'not-measured',
        reason:
          `this tool could not start it (${measured.status.reason.replace(/\.$/, '')}), and your sessions ` +
          `can: it has answered ${plural(calls, 'call')}. The usual cause is a login the client holds ` +
          'and this tool does not',
      };
    }
    return { kind: 'broken', reason: measured.status.reason };
  }
  if (sessionsSince === null) {
    // 🔑 The honest branch, and it covers most servers on most machines: `~/.claude.json` is not
    // version controlled, so nothing on disk says when this arrived. Zero calls across every
    // session on record is real evidence, but it is not evidence that the server is old, and the
    // reader is the only one who knows which. Saying so beats guessing either way.
    if (calls > 0) {
      // 🔑 The cost floor has to survive an unknown age, or it misses the most expensive row on
      // this machine: `~/.claude.json` servers are undatable, and one of them is 8,504 tokens on
      // every turn for a single call. The denominator is labelled as an upper bound instead of the
      // finding being withheld, which is the same trade the `never-called` branch refuses to make
      // only because there the claim would be that something is dead.
      if (windowSessions >= minSessions && perCall !== null && calls / windowSessions < RARELY_CALLED) {
        return { kind: 'rarely-called', calls, sessions: windowSessions, perCall, window: 'on record', scope };
      }
      return { kind: 'earning-it', calls, sessions: windowSessions, window: 'on record', scope };
    }
    return {
      kind: 'never-called-age-unknown',
      sessions: windowSessions,
      why: since.known ? '' : since.reason,
      scope,
    };
  }
  if (calls > 0) {
    if (sessionsSince >= minSessions && perCall !== null && calls / sessionsSince < RARELY_CALLED) {
      return {
        kind: 'rarely-called',
        calls,
        sessions: sessionsSince,
        perCall,
        window: 'since it was configured',
        scope,
      };
    }
    return { kind: 'earning-it', calls, sessions: sessionsSince, window: 'since it was configured', scope };
  }
  if (sessionsSince < minSessions) return { kind: 'too-new', sessions: sessionsSince, scope };
  return { kind: 'never-called', sessions: sessionsSince, window: 'since it was configured', scope };
}

/**
 * Everything a set of projects called, rolled up.
 *
 * Extracted so the same arithmetic can be run twice over different slices of the same scan: once
 * for this directory tree and once for the machine. The two results are never merged. A row picks
 * one of them and the screen says which, because a denominator you cannot name is a denominator
 * you cannot check.
 */
function aggregate(projects: ProjectEvidence[]): Usage {
  const calls = new Map<string, number>();
  /** server -> tool -> calls. A mostly-dead server with one hot tool is visible as such. */
  const toolCalls = new Map<string, Map<string, number>>();
  const skillModelCalls = new Map<string, number>();
  const skillTypedCalls = new Map<string, number>();
  /** Keyed by `subagent_type`, which takes the same two name forms `callsFor` handles. */
  const agentCalls = new Map<string, number>();

  for (const project of projects) {
    for (const [name, use] of Object.entries(project.mcpServers)) {
      calls.set(name, (calls.get(name) ?? 0) + use.calls);
      const perTool = toolCalls.get(name) ?? new Map<string, number>();
      for (const [tool, count] of Object.entries(use.tools)) {
        perTool.set(tool, (perTool.get(tool) ?? 0) + count);
      }
      toolCalls.set(name, perTool);
    }
    for (const [name, use] of Object.entries(project.skills)) {
      skillModelCalls.set(name, (skillModelCalls.get(name) ?? 0) + use.model);
    }
    // \u26a0\ufe0f Typed invocations live here and not in `skills[].user`, which the scanner never fills:
    // the scanner cannot tell a skill from a built-in like `/compact` without the resolved config,
    // so it records every `/name` and leaves the filtering to this join, which has the config.
    for (const [name, count] of Object.entries(project.slashCommands)) {
      skillTypedCalls.set(name, (skillTypedCalls.get(name) ?? 0) + count);
    }
    for (const [name, count] of Object.entries(project.agents)) {
      agentCalls.set(name, (agentCalls.get(name) ?? 0) + count);
    }
  }

  return { calls, toolCalls, skillModelCalls, skillTypedCalls, agentCalls };
}

/**
 * What every project on this machine adds up to, and what the user typed to survive it.
 *
 * ⚠️ Two different bases on purpose, because the honest answer to each is a different set.
 * `sessions` counts only what a human started, since a subagent transcript is not a session and
 * counting it as one inflates every per-session number in the tool. `turns` and `contextTokens`
 * count **everything**, subagents included, because those turns were billed and the line's whole
 * job is to say what this machine has actually carried.
 */
function machineTotals(evidence: Evidence, sessions: SessionEvidence[]): MachineEvidence {
  let clears = 0;
  let compacts = 0;
  for (const project of evidence.projects) {
    clears += project.slashCommands['clear'] ?? 0;
    compacts += project.slashCommands['compact'] ?? 0;
  }
  return {
    sessions: sessions.length,
    turns: evidence.sessions.reduce((sum, session) => sum + session.turns, 0),
    contextTokens: evidence.sessions.reduce((sum, session) => sum + session.contextTokens, 0),
    clears,
    compacts,
  };
}

export function buildLedger(
  resolved: ResolveResult,
  measure: MeasureResult,
  evidence: Evidence,
  options: LedgerOptions = {},
): Ledger {
  const { config } = resolved;
  const windowSize = options.window ?? DEFAULT_WINDOW;
  const minSessions = options.minSessions ?? DEFAULT_MIN_SESSIONS;
  const root = config.repoRoot ?? config.cwd;

  // Subagent transcripts are billed work but carry a different prefix, so they would bias the
  // cold-start median and inflate every per-session denominator derived from this list.
  const allSessions = evidence.sessions
    .filter((session) => session.kind === 'session')
    .sort((a, b) => (b.firstSeen ?? '').localeCompare(a.firstSeen ?? ''));
  const sessions = allSessions.filter((session) => under(session.cwd, root));

  // A session a script started is billed like any other and is counted in every denominator, but
  // it is often run under settings nobody works with, so it does not get to say what a turn costs
  // here while a session a person started can.
  const started = sessions.some((session) => !session.headless)
    ? sessions.filter((session) => !session.headless)
    : sessions;
  const recent = started.filter((session) => session.coldStartTokens !== null).slice(0, windowSize);
  const total = median(recent.map((session) => session.coldStartTokens ?? 0));
  const windowLabel =
    recent.length === 0
      ? 'no session here recorded a cold start'
      : `${recent.length} most recent session${recent.length === 1 ? '' : 's'}, ` +
        `${(recent[recent.length - 1].firstSeen ?? '').slice(0, 10)} to ${(recent[0].firstSeen ?? '').slice(0, 10)}`;

  /**
   * 🔑 What one of those sessions actually sent. When there is one, every row it covers is read
   * from it and not modelled; see `evidence/record.ts`. The window's own sessions come first, so
   * the rows and the exact total describe the same stretch of history.
   */
  const picked = pickRecord(recent) ?? pickRecord(sessions);
  const record = picked?.record ?? null;
  const knowsServers = record !== null && (record.toolList !== null || Object.keys(record.servers).length > 0);
  const claimedKeys = new Set<string>();

  const here = aggregate(evidence.projects.filter((project) => under(project.cwd, root)));
  const everywhere = aggregate(evidence.projects);

  /**
   * This project cannot judge anything, so the machine has to.
   *
   * Below `minSessions` there is no denominator here worth printing, and the old behaviour was to
   * print a table of dashes: `share`, `calls` and `per call` all empty, which is every column that
   * carries the argument. The history to answer it was on the same disk the whole time, one
   * directory up. Widening is only honest because the scope is then said on the screen.
   */
  const thin = sessions.length < minSessions && allSessions.length >= minSessions;

  const usageIn = (scope: EvidenceScope): Usage => (scope === 'machine' ? everywhere : here);
  const sessionsIn = (scope: EvidenceScope): number =>
    scope === 'machine' ? allSessions.length : sessions.length;

  /**
   * 🔑 The two rules every denominator on this screen has to satisfy at once.
   *
   * **The floor: it must cover everything its fix would switch off.** `claude mcp remove <name>
   * -s user` is machine-wide, so recommending it on this project's silence is a recommendation to
   * break the project next door. Found on a real machine: a server with one call in 152 sessions
   * here, 67 in a sibling repo, and a `-s user` removal printed against it.
   *
   * **The ceiling: it must not cover sessions the thing could never have been loaded in.** A
   * `.mcp.json` server exists in one project, so the machine's history is not a wider window on
   * the same question. Widening is therefore earned by reach and never by need: a project that
   * cannot judge a project-scoped server says so, and says nothing else. See `reach.ts`.
   */
  const serverScope = (server: ResolvedMcpServer): EvidenceScope =>
    server.fixLever.kind === 'claude-mcp-remove' && server.fixLever.scope === 'user'
      ? 'machine'
      : thin && serverReach(server, config.plugins, config.sources) === 'machine'
        ? 'machine'
        : 'project';

  /** Skills have no machine-wide lever, so they widen only when starved — and only if they reach. */
  const skillScope = (skill: ResolvedSkill): EvidenceScope =>
    thin && skillReach(skill, config.plugins, config.sources) === 'machine' ? 'machine' : 'project';

  const skillCalls = (skill: ResolvedSkill): { model: number; typed: number } => {
    const usage = usageIn(skillScope(skill));
    return {
      model: callsFor(usage.skillModelCalls, skill.name, skill.plugin),
      typed: callsFor(usage.skillTypedCalls, skill.name, skill.plugin),
    };
  };

  /**
   * 🚨 The same floor the servers have had since `0.2.0`, which skills never got.
   *
   * `N skills never invoked` was reachable on a machine two sessions old, where it is not a
   * finding but a description of a machine two sessions old. Silence is only evidence once there
   * is enough of it, and the count that has to clear the bar is the one this skill is judged over.
   */
  const skillJudgeable = (skill: ResolvedSkill): boolean =>
    sessionsIn(skillScope(skill)) >= minSessions;

  /**
   * Never a bare session count. The reader has to be able to see which history it was counted over.
   *
   * The skills in any one finding always share a scope, so one sentence can carry it. They cannot
   * differ: a machine-scoped skill needs `thin`, a judgeable project-scoped one needs the opposite,
   * and `skillJudgeable` has already dropped everything below the floor.
   */
  const overSessions = (scope: EvidenceScope): string =>
    `${sessionsIn(scope)} session${sessionsIn(scope) === 1 ? '' : 's'} ` +
    `${scope === 'machine' ? 'on this machine' : 'here'}`;

  /**
   * Has nothing this plugin provides ever been used?
   *
   * 🚨 The guard on the only all-or-nothing lever in the tool. `enabledPlugins` switches off a
   * plugin's servers, skills, agents and commands together, so proposing it because one skill is
   * unused would take four working things with it. Every surface the plugin contributes is checked,
   * and a single call anywhere is enough to rule the lever out.
   */
  const pluginIsIdle = (id: string): boolean => {
    // \u{1F6A8} Machine-wide on purpose, and stricter than every other denominator here. This guards the
    // only lever that takes four things away at once, so a single call anywhere on the machine has
    // to be enough to rule it out. Scoping it to this tree would switch off a plugin that is
    // working in another repo, and the tool would report success while doing it.
    const usedServer = config.mcpServers.some(
      (server) => server.plugin === id && serverCalls(everywhere.calls, server.name, id) > 0,
    );
    const usedSkill = config.skills.some(
      (skill) =>
        skill.plugin === id &&
        callsFor(everywhere.skillModelCalls, skill.name, id) +
          callsFor(everywhere.skillTypedCalls, skill.name, id) >
          0,
    );
    const usedAgent = config.agents.some(
      (agent) => agent.plugin === id && callsFor(everywhere.agentCalls, agent.name, id) > 0,
    );
    const usedCommand = config.commands.some(
      (command) => command.plugin === id && callsFor(everywhere.skillTypedCalls, command.name, id) > 0,
    );
    return !usedServer && !usedSkill && !usedAgent && !usedCommand;
  };

  const share = (tokens: number | null): number | null =>
    tokens === null || total === null || total === 0 ? null : tokens / total;

  const rows: LedgerRow[] = [];
  const findings: Finding[] = [];

  for (const measured of measure.servers) {
    const declared = config.mcpServers.find((entry) => entry.name === measured.name);
    if (declared === undefined) continue;
    const scope = serverScope(declared);
    const usage = scope === 'machine' ? everywhere : here;
    const scoped = scope === 'machine' ? allSessions : sessions;
    const used = serverCalls(usage.calls, measured.name, declared.plugin);
    // Scoped to the same window the verdict uses. A server added last week must not be charged for
    // turns taken before it existed.
    const inWindow = startedSince(scoped, declared.configuredSince) ?? scoped;
    const turns = turnsIn(inWindow);
    // 🔑 Every per-turn number below is the **resident** one. The client defers tool schemas, so
    // charging a server's whole serialized weight to every turn would overstate acme by 3.2x.
    // `measured.tokens` is still the right number for what a load costs, and it rides along.
    //
    // 🔑 And when a session recorded what it sent, that is the number, not the probe. A client that
    // defers sends a tool's **name** and nothing else until something loads it, so a probe that
    // charges name plus description runs high; and a server the client could not connect sent
    // nothing at all, whatever it weighs when this tool starts it.
    for (const key of transcriptKeysFor(measured.name, declared.plugin)) claimedKeys.add(key);
    // Summed, not the first hit: a server declared twice can be loaded twice, once under each name,
    // and both copies are in the prompt whichever declaration this tool says wins.
    const sentCopies = transcriptKeysFor(measured.name, declared.plugin).flatMap((key) => {
      const copy = record?.servers[key];
      return copy === undefined ? [] : [copy];
    });
    const sentServer: SentServer | null =
      sentCopies.length === 0
        ? null
        : sentCopies.reduce((sum, copy) => ({
            tools: sum.tools + copy.tools,
            nameChars: sum.nameChars + copy.nameChars,
            instructionChars: sum.instructionChars + copy.instructionChars,
            schemaChars: sum.schemaChars + copy.schemaChars,
          }));
    // Added after the session the record is from: that session could not have sent it.
    const newerThanRecord =
      picked !== null &&
      declared.configuredSince.known &&
      declared.configuredSince.iso > (picked.session.firstSeen ?? '');
    const notSent = knowsServers && sentServer === null && !newerThanRecord;
    const perTurn =
      sentServer !== null
        ? toTokens(sentServer.nameChars + sentServer.instructionChars + sentServer.schemaChars)
        : notSent
          ? 0
          : measured.residentTokens;
    const perCall = perTurn === null || used === 0 ? null : Math.round((perTurn * turns) / used);
    const verdict: Verdict = notSent
      ? {
          kind: 'not-sent',
          reason:
            // No pronoun: identical notes are merged, so this is printed against two servers as often
            // as against one.
            (record?.failedServers.some((name) => transcriptKeysFor(measured.name, declared.plugin).includes(name)) === true
              ? `Claude Code could not connect in your session of ${picked?.day ?? ''}, so nothing was sent`
              : `nothing was sent in your session of ${picked?.day ?? ''}, so not connected there`) +
            (measured.residentTokens === null || measured.residentTokens === 0
              ? ''
              : `. Started here: ${measured.residentTokens.toLocaleString('en-US')} tokens`),
        }
      : serverVerdict(
      measured,
      used,
      perCall,
      startedSince(scoped, declared.configuredSince)?.length ?? null,
      declared.configuredSince,
      scoped.length,
      minSessions,
      scope,
    );
    rows.push({
      label: measured.name,
      kind: 'mcp-server',
      tokens: perTurn,
      // Never below what is already resident: a server whose schemas the client loaded up front
      // has nothing waiting behind it.
      loadedTokens: measured.tokens === null || perTurn === null ? measured.tokens : Math.max(measured.tokens, perTurn),
      share: share(perTurn),
      /**
       * 🔑 A dash, not a zero, when there is no history in scope at all.
       *
       * `0` in the calls column is a measurement, and next to a note reading *no sessions yet* it
       * is a measurement of nothing. The two glyphs say different things and the reader acts on
       * the difference: `share` and `per call` already go to a dash here for the same reason.
       */
      calls: scoped.length === 0 ? null : used,
      perCall,
      basis: basisFor(measured),
      verdict,
      fix: fixFor(declared),
    });

    if (verdict.kind === 'broken') {
      findings.push({
        headline: `${measured.name} cannot start, so it gives your sessions nothing`,
        detail:
          `${verdict.reason.replace(/\.$/, '')}. It has ${used} call${used === 1 ? '' : 's'} on record, ` +
          'which is what a server that never starts would have.',
        saves: null,
        fix: `repair it, or if you no longer want it: ${fixFor(declared)}`,
        // 🚨 Deliberately no action. A server that cannot start is a thing to repair, and a tool
        // that quietly switched it off would be destroying the evidence that it is broken.
        actions: [],
      });
      continue;
    }
    // The loaded half, said once and reused: it is the second sentence of both findings below.
    const loadedClause =
      measured.tokens === null || perTurn === null
        ? ''
        : ` Loading its schemas costs ${(measured.tokens - perTurn).toLocaleString('en-US')} tokens more,` +
          ' every time something does.';
    // 🚨 Nothing is said about a server that costs nothing. One that exposes no tools weighs zero
    // and cannot be called at all, so *"costs 0 tokens every turn and has never been called"* is
    // true, empty, and printed as a finding beside the ones that matter.
    if (verdict.kind === 'rarely-called' && perTurn !== null && perTurn > 0) {
      findings.push({
        headline:
          `${measured.name} is loaded on every turn and used in ${verdict.calls} of ` +
          `${verdict.sessions} sessions${where(verdict.scope)}`,
        detail:
          `${perTurn.toLocaleString('en-US')} tokens re-sent across ${turns.toLocaleString('en-US')} turns for ` +
          `${verdict.calls} call${verdict.calls === 1 ? '' : 's'}: ${verdict.perCall.toLocaleString('en-US')} tokens of ` +
          `standing cost per use` +
          (verdict.window === 'on record'
            ? ', counted over every session on record because nothing says when this was added, so read it as an upper bound.'
            : '.') +
          loadedClause,
        saves: perTurn,
        fix: fixFor(declared),
        actions: serverActions(
          declared,
          perTurn,
          `${measured.name} costs ${perTurn.toLocaleString('en-US')} tokens every turn for ` +
            `${verdict.calls} call${verdict.calls === 1 ? '' : 's'} in ${verdict.sessions} ` +
            `sessions${where(verdict.scope)}.`,
          pluginIsIdle,
        ),
      });
    }
    if (verdict.kind === 'never-called' && perTurn !== null && perTurn > 0) {
      findings.push({
        headline: `${measured.name} costs ${perTurn.toLocaleString('en-US')} tokens every turn and has never been called`,
        detail:
          `0 calls in ${verdict.sessions} session${verdict.sessions === 1 ? '' : 's'}` +
          `${where(verdict.scope)} ${verdict.window}.` +
          loadedClause,
        saves: perTurn,
        fix: fixFor(declared),
        actions: serverActions(
          declared,
          perTurn,
          `${measured.name} costs ${perTurn.toLocaleString('en-US')} tokens every turn and ` +
            `has never been called in ${verdict.sessions} sessions${where(verdict.scope)} ` +
            `${verdict.window}.`,
          pluginIsIdle,
        ),
      });
    }

    // A mostly-dead server with one hot tool is a different problem from a dead one, and the fix
    // is different too: prune the tools, do not drop the server. Suppressed when the server has
    // already produced a finding of its own, because "drop this server" and "prune four of its
    // tools" one after the other reads as two problems when there is one.
    //
    // 🚨 And suppressed when *every* tool looks unused, which is never a tool-pruning
    // finding. The verdict is `earning-it`, so the calls are real; if not one of them matches a
    // tool the server declares today, the server has renamed its tools since, and what that shows
    // is evidence that can no longer be attributed, not eight idle tools. Printing "8 of its 8
    // tools have never been called" beside a row reading 372 calls is the one contradiction a
    // reader cannot resolve, and they resolve it by disbelieving both numbers. Found against a
    // real renamed server, which is why the guard counts against the tool list rather than
    // asking for more than one tool.
    const perTool = serverToolCalls(usage.toolCalls, measured.name, declared.plugin);
    const unusedTools = measured.tools.filter((tool) => (perTool.get(tool.name) ?? 0) === 0);
    if (
      verdict.kind === 'earning-it' &&
      unusedTools.length > 0 &&
      unusedTools.length < measured.tools.length
    ) {
      const wasted = unusedTools.reduce((sum, tool) => sum + tool.chars, 0);
      // Both halves, because they are paid at different times: the listing on every turn, the
      // schema only when something loads it. One number would have to pick a lie.
      const listed = unusedTools.every((tool) => tool.listingChars !== null)
        ? unusedTools.reduce((sum, tool) => sum + (tool.listingChars ?? 0), 0)
        : null;
      findings.push({
        headline: `${measured.name}: ${unusedTools.length} of its ${measured.tools.length} tools have never been called`,
        detail:
          `${unusedTools.map((tool) => tool.name).join(', ')}. ` +
          (listed === null
            ? ''
            : `Their names and descriptions cost ${toTokens(listed).toLocaleString('en-US')} tokens on every turn, and `) +
          `${toTokens(wasted).toLocaleString('en-US')} tokens of schema you have never used waits behind them.`,
        saves: null,
        fix: 'MCP has no per-tool switch. Ask the server for a narrower tool set, or drop the server.',
        // The protocol offers nothing to write. Naming the absence beats emitting a settings key
        // that would not do it.
        actions: [],
      });
    }
  }

  /**
   * Servers the session sent that no file on this machine declares.
   *
   * 🔑 Connectors attached to a claude.ai account, and the ones the client ships with, are real
   * context in every session and are written down nowhere this tool reads. They used to be a
   * paragraph under the table saying so. The record lists them with their tools, so they are rows.
   * Account-wide by nature, so they are judged over the machine, and their age is never known.
   */
  if (record !== null) {
    const small: { key: string; tokens: number; used: number }[] = [];
    for (const [key, sentServer] of Object.entries(record.servers)) {
      if (claimedKeys.has(key)) continue;
      const tokens = toTokens(sentServer.nameChars + sentServer.instructionChars + sentServer.schemaChars);
      const used = everywhere.calls.get(key) ?? 0;
      // A connector that is waiting for a login sends one tool name. Four of those are four rows of
      // twenty tokens each, which is a table about nothing, so they share a row.
      if (tokens < SMALL_SERVER) {
        small.push({ key, tokens, used });
        continue;
      }
      const turns = turnsIn(allSessions);
      const perCall = used === 0 ? null : Math.round((tokens * turns) / used);
      const rarely =
        used > 0 && allSessions.length >= minSessions && used / allSessions.length < RARELY_CALLED && perCall !== null;
      const verdict: Verdict =
        used === 0
          ? {
              kind: 'never-called-age-unknown',
              sessions: allSessions.length,
              why: 'no file on this machine declares it, so nothing says when it was connected',
              scope: 'machine',
            }
          : rarely
            ? { kind: 'rarely-called', calls: used, sessions: allSessions.length, perCall, window: 'on record', scope: 'machine' }
            : { kind: 'earning-it', calls: used, sessions: allSessions.length, window: 'on record', scope: 'machine' };
      const outsideFix =
        'no file here declares it, so there is nothing for this tool to edit. /mcp in a session shows where it ' +
        'is connected from, and a claude.ai connector is switched off in your claude.ai settings';
      rows.push({
        label: key,
        kind: 'mcp-server',
        tokens,
        loadedTokens: null,
        share: share(tokens),
        calls: allSessions.length === 0 ? null : used,
        perCall,
        basis: null,
        verdict,
        fix: outsideFix,
      });
      if (verdict.kind === 'rarely-called' && tokens > 0) {
        findings.push({
          headline:
            `${key} is sent on every turn and used in ${verdict.calls} of ${verdict.sessions} sessions on this machine`,
          detail:
            `${tokens.toLocaleString('en-US')} tokens of tool names and instructions across ` +
            `${turns.toLocaleString('en-US')} turns for ${plural(verdict.calls, 'call')}. No file on this machine ` +
            'declares it, so its age is unknown and the per-call figure is an upper bound.',
          // Counted as recoverable the way a `claude mcp remove` is: real, and yours to do.
          saves: tokens,
          fix: outsideFix,
          actions: [{ kind: 'manual', command: null, why: `${key} costs ${tokens.toLocaleString('en-US')} tokens every turn. ${outsideFix}.` }],
        });
      }
    }
    if (small.length > 0) {
      const tokens = small.reduce((sum, server) => sum + server.tokens, 0);
      rows.push({
        label: `${small.length} small connector${small.length === 1 ? '' : 's'}`,
        kind: 'mcp-server',
        count: small.length,
        tokens,
        loadedTokens: null,
        share: share(tokens),
        calls: allSessions.length === 0 ? null : small.reduce((sum, server) => sum + server.used, 0),
        perCall: null,
        basis: null,
        verdict: {
          kind: 'not-attributable',
          why: `${small.map((server) => server.key).join(', ')}: under ${SMALL_SERVER} tokens each, and in no file on this machine`,
        },
        fix: null,
      });
    }
  }

  /* Skills, agents and memory are one row each; the per-item recommendation is a finding. */

  /**
   * A finding's skills as actions, routed by where each skill came from.
   *
   * 🔑 `skillOverrides` has **no effect on a plugin skill**. Emitting one anyway would be the worst
   * kind of fix: it writes a file, reports success, and changes nothing. A plugin skill is therefore
   * either folded into a whole-plugin switch — only when nothing that plugin provides has been used
   * — or handed back with the reason there is no lever.
   *
   * 🚨 Handed back **once per plugin**, never once per skill. A plugin with a hundred unused skills
   * used to produce a hundred copies of one sentence, and the few edits `fix` does make were
   * somewhere underneath them. `stuck` is the count across every skills finding, so the sentence is
   * identical wherever it is emitted and `mergeActions` folds the copies into one line.
   */
  const skillActions = (
    skills: ResolvedSkill[],
    value: SkillOverride,
    whyFor: (skill: ResolvedSkill) => string,
    savings: Map<string, number>,
    stuck: Map<string, number>,
  ): FixAction[] => {
    const actions: FixAction[] = [];
    const handedBack = new Set<string>();
    for (const skill of skills) {
      const saves = savings.get(skillKey(skill)) ?? 0;
      if (skill.plugin === null) {
        actions.push({
          kind: 'skill-override',
          skill: skill.name,
          value,
          settingsPath: config.settingsTarget,
          why: whyFor(skill),
          saves,
        });
        continue;
      }
      if (pluginIsIdle(skill.plugin)) {
        actions.push({
          kind: 'disable-plugin',
          plugin: skill.plugin,
          // This project's settings file, for the reason spelled out on the `enabledPlugins` lever
          // in `resolve/mcp.ts`: the evidence is repo-scoped, so the edit has to be. Project scope
          // works — this repo's own `.claude/settings.json` already carries an `enabledPlugins` block.
          settingsPath: config.settingsTarget,
          why: `nothing the ${skill.plugin} plugin provides has been used anywhere on this machine`,
          saves,
        });
        continue;
      }
      if (handedBack.has(skill.plugin)) continue;
      handedBack.add(skill.plugin);
      const count = stuck.get(skill.plugin) ?? 1;
      actions.push({
        kind: 'manual',
        command: null,
        why:
          `${plural(count, 'skill')} the model has never chosen ${count === 1 ? 'comes' : 'come'} from the ` +
          `${skill.plugin} plugin, and skillOverrides does not apply to plugin skills. The only ` +
          'switch is the whole plugin, which you do use.',
      });
    }
    return actions;
  };

  /**
   * The `fix:` line under a skills finding, routed the same way the actions are.
   *
   * One finding can hold three kinds of skill and each takes a different lever, so the sentence is
   * built from the kinds actually present. Telling the reader to set a plugin skill in
   * `skillOverrides` is advice that silently does nothing, which is the one thing this line exists
   * to not say.
   */
  const skillFixLine = (skills: ResolvedSkill[], ownOnly: string, ownAmongOthers: string): string => {
    const idlePlugins = [
      ...new Set(
        skills.flatMap((skill) => (skill.plugin !== null && pluginIsIdle(skill.plugin) ? [skill.plugin] : [])),
      ),
    ];
    const stuck = skills.some((skill) => skill.plugin !== null && !pluginIsIdle(skill.plugin));
    if (idlePlugins.length === 0 && !stuck) return ownOnly;
    const parts: string[] = [];
    if (skills.some((skill) => skill.plugin === null)) parts.push(ownAmongOthers);
    if (idlePlugins.length > 0) {
      parts.push(`set ${idlePlugins.map((id) => `"${id}": false`).join(', ')} in enabledPlugins`);
    }
    if (stuck) {
      parts.push(
        parts.length > 0
          ? 'the ones from a plugin you use have no switch of their own'
          : 'none. skillOverrides does not apply to plugin skills, and the only switch is a whole plugin you use',
      );
    }
    return parts.join('; ');
  };

  const visibleSkills = config.skills.filter((skill) => skill.shadowedBy === null);

  /**
   * 🚨 The skills row is what the listing costs as the client packs it, not the descriptions on
   * disk. See `measure/skill-listing.ts` for the packing and for why the old sum was several times
   * too large on any config carrying a big plugin.
   *
   * The window comes from the same recent sessions the exact total does, because both have to
   * describe the config and the model you run now.
   */
  const listedSkills = toListedSkills(config.skills, config.skillListing);
  const listedByKey = new Map(listedSkills.map((skill) => [skill.key, skill]));
  const windowEvidence = recent.length > 0 ? recent : allSessions.slice(0, windowSize);
  /**
   * 🔑 The record first. A session that recorded its listing says what was sent, how many skills
   * lost their description, and by arithmetic what budget took them. The packing model below is
   * what is left when no session here recorded one, and its window is then a guess that says so.
   */
  const sentListing = record === null ? null : readSentListing(record, listedSkills, config.skillListing);
  const contextWindow = inferContextWindow(windowEvidence.map((session) => session.peakContextTokens));
  const listingBudget =
    sentListing === null ? skillListingBudgetChars(config.skillListing, contextWindow) : sentListing.budget.chars;
  const listingPopulation = sentListing === null ? listedSkills : sentListing.population;
  const packed = packSkillListing(listingPopulation, listingBudget);
  const skillTokens = sentListing === null ? toTokens(packed.chars) : sentListing.tokens;
  const aboutBudget = (chars: number): string => `about ${chars.toLocaleString('en-US')} characters`;
  const sentListingNote = (): string => {
    if (sentListing === null) return '';
    const day = picked?.day ?? '';
    const since =
      sentListing.hiddenSince === 0
        ? ''
        : `. ${plural(sentListing.hiddenSince, 'skill')} listed there ${sentListing.hiddenSince === 1 ? 'is' : 'are'} switched off now, so your next session sends less`;
    if (sentListing.dropped.length === 0) {
      return `as sent in your session of ${day}, every description included${since}`;
    }
    const { budget } = sentListing;
    const cap =
      budget.basis === 'env'
        ? `${budget.chars.toLocaleString('en-US')} characters, set by SLASH_COMMAND_TOOL_CHAR_BUDGET`
        : `${aboutBudget(budget.chars)}` +
          (budget.windowTokens === null
            ? ''
            : `, its share of a window of about ${budget.windowTokens.toLocaleString('en-US')} tokens`);
    return (
      `as sent in your session of ${day}: ${plural(sentListing.dropped.length, 'skill')} went as a name with no ` +
      `description, because Claude Code caps this listing at ${cap}${since}`
    );
  };

  rows.push({
    label: plural(sentListing === null ? packed.listed : sentListing.entries, 'skill'),
    kind: 'skills',
    count: sentListing === null ? packed.listed : sentListing.entries,
    tokens: skillTokens,
    // No second half: the frontmatter is resident and the body is not counted anywhere.
    loadedTokens: null,
    share: share(skillTokens),
    calls: visibleSkills.reduce((sum, skill) => sum + skillCalls(skill).model, 0),
    perCall: null,
    basis: null,
    verdict: {
      kind: 'not-attributable',
      why: sentListing !== null
        ? sentListingNote()
        : packed.overBudget
        ? `modelled, because no session here recorded its listing. Claude Code caps it at ${packed.budgetChars.toLocaleString('en-US')} characters ` +
          `(${config.skillListing.envBudgetChars !== null ? 'set by SLASH_COMMAND_TOOL_CHAR_BUDGET' : `its share of a ${contextWindow.toLocaleString('en-US')}-token window, which is a guess from how large your turns have run`}) ` +
          `and these descriptions run to ${packed.uncappedChars.toLocaleString('en-US')}, so ` +
          `about ${plural(packed.demoted, 'skill')} ${packed.demoted === 1 ? 'is' : 'are'} listed by name alone. ` +
          'This is a ceiling: the client\'s own bundled skills take room first and appear in no file'
        : 'a skill listing is one line each; the useful unit is the skill, below',
    },
    fix: null,
  });

  /**
   * What the agent never received.
   *
   * 🔑 The finding people feel. "Tokens per turn" is a unit nobody notices; "Claude ignores the
   * skill I wrote" is a thing they have said out loud, and this is very often why: past the budget
   * the client keeps every name and drops descriptions, and a name alone gives the model nothing to
   * choose a skill by. It is first on the screen because it is about the agent working, and every
   * finding under it is about the bill.
   *
   * Read, never modelled. The client decides which descriptions survive by recent use, which no
   * file records, so without a session that recorded its listing this says nothing at all.
   */
  let listingBudgetOffer: ListingBudgetOffer | null = null;
  if (sentListing !== null && sentListing.dropped.length > 0) {
    const sentSkills = record?.skillListing?.skills ?? [];
    const ownNames = new Set(
      config.skills.filter((skill) => skill.plugin === null && skill.shadowedBy === null).map((skill) => skill.name),
    );
    const ownerLabel = (name: string): string =>
      ownerOf(name) ?? (ownNames.has(name) ? 'your own' : 'built in');
    const byOwner = new Map<string, { dropped: string[]; listed: number }>();
    for (const skill of sentSkills) {
      const owner = ownerLabel(skill.name);
      const entry = byOwner.get(owner) ?? { dropped: [], listed: 0 };
      entry.listed += 1;
      byOwner.set(owner, entry);
    }
    for (const skill of sentListing.dropped) byOwner.get(ownerLabel(skill.name))?.dropped.push(skill.name);
    const owners = [...byOwner.entries()]
      .filter(([, entry]) => entry.dropped.length > 0)
      .sort((a, b) => b[1].dropped.length - a[1].dropped.length)
      .map(([owner, entry]) => {
        // The ones you wrote are named. They are the ones you will recognise, and the ones you can
        // do something about without asking anybody.
        const named =
          owner === 'your own'
            ? ` (${entry.dropped.slice(0, 6).join(', ')}${entry.dropped.length > 6 ? ', ...' : ''})`
            : '';
        return `${owner} ${entry.dropped.length} of ${entry.listed}${named}`;
      });

    const offer = fractionToSendAll(sentListing, config.skillListing);
    if (offer !== null) {
      listingBudgetOffer = {
        ...offer,
        atLeast: sentListing.uncappedIsFloor,
        settingsPath: config.settingsTarget,
      };
    }
    const runsTo =
      `${sentListing.uncappedIsFloor ? 'at least ' : 'about '}` +
      `${sentListing.uncappedChars.toLocaleString('en-US')}`;
    const wayOut =
      offer !== null
        ? `set skillListingBudgetFraction to ${sentListing.uncappedIsFloor ? 'at least ' : ''}${offer.fraction} and ` +
          `every description is sent, for about ${offer.addsTokens.toLocaleString('en-US')} more tokens on every turn ` +
          '(context-tax fix --restore-descriptions writes it). Or make room: each skill switched off below hands ' +
          'its space to another description'
        : sentListing.budget.basis === 'env'
          ? `raise SLASH_COMMAND_TOOL_CHAR_BUDGET to ${runsTo} characters and every description is sent. ` +
            'Or make room: each skill switched off below hands its space to another description'
          : 'make room: each skill switched off below hands its space to another description';

    findings.unshift({
      headline:
        `${sentListing.dropped.length} of your ${plural(sentListing.entries, 'skill')} ` +
        `${sentListing.dropped.length === 1 ? 'reaches' : 'reach'} the model as a name with no description`,
      // Four lines is what the screen gives a detail, so the owners go first and every clause after
      // them is kept short enough to survive the clamp.
      detail:
        `${owners.join(', ')}. A bare name gives the model nothing to choose a skill by. The cap is ` +
        `${sentListing.budget.basis === 'env' ? '' : 'about '}${sentListing.budget.chars.toLocaleString('en-US')} ` +
        `characters and yours needs ${runsTo}. From your session of ${picked?.day ?? ''}; who loses out ` +
        'shifts with recent use.',
      // Not a saving. One way out costs tokens and the other is already counted by the findings below.
      saves: null,
      fix: wayOut,
      actions: [],
    });
  }

  const judgeableSkills = visibleSkills.filter(skillJudgeable);
  // A skill the model is never told about costs nothing, so there is nothing in it to recover.
  const recoverableSkills = judgeableSkills.filter(
    (skill) => listedByKey.get(skillKey(skill))?.form !== 'hidden',
  );

  /**
   * What a finding recovers, per skill, in tokens.
   *
   * 🔑 Only a skill with a lever leaves the listing, so only those are counted: a plugin skill
   * whose plugin you use has no switch, and a number promised for it is a number `fix` can never
   * deliver. And the saving is the listing before minus the listing after, never a sum of lines,
   * because past the budget the client hands freed room to another description. Findings are
   * charged in order against one shrinking listing, so they add up.
   */
  const leftListing = new Set<string>();
  const savingsFor = (skills: ResolvedSkill[]): Map<string, number> => {
    const withLever = skills.filter((skill) => skill.plugin === null || pluginIsIdle(skill.plugin));
    const keys = withLever.map(skillKey);
    const total = toTokens(savedBy(listingPopulation, listingBudget, new Set(keys), leftListing));
    for (const key of keys) leftListing.add(key);
    const shares = apportion(
      total,
      keys.map((key) => {
        const listed = listedByKey.get(key);
        return listed === undefined ? 0 : lineChars(listed);
      }),
    );
    return new Map(keys.map((key, index) => [key, shares[index]]));
  };
  const sumOf = (savings: Map<string, number>): number =>
    [...savings.values()].reduce((sum, value) => sum + value, 0);
  // First in the detail, not last: the renderer clamps a detail to four lines, and a list of names
  // long enough to be over the budget is exactly the list that would push this off the screen.
  const overBudgetNote = (sentListing === null ? packed.overBudget : sentListing.dropped.length > 0)
    ? 'The listing is over its budget, so most of what this frees goes to another description rather than out of the prompt. '
    : '';

  const typedOnly = recoverableSkills.filter(
    (skill) => skillCalls(skill).model === 0 && skillCalls(skill).typed > 0,
  );
  const neverUsedSkills = recoverableSkills.filter(
    (skill) => skillCalls(skill).model === 0 && skillCalls(skill).typed === 0,
  );
  // Counted over both findings before either is written, so the one note a plugin gets carries the
  // whole number and reads the same from whichever finding emits it.
  const stuckByPlugin = new Map<string, number>();
  for (const skill of [...typedOnly, ...neverUsedSkills]) {
    if (skill.plugin === null || pluginIsIdle(skill.plugin)) continue;
    stuckByPlugin.set(skill.plugin, (stuckByPlugin.get(skill.plugin) ?? 0) + 1);
  }

  if (typedOnly.length > 0) {
    const savings = savingsFor(typedOnly);
    findings.push({
      headline: `${typedOnly.length} skill${typedOnly.length === 1 ? '' : 's'} you only ever type, never let the model choose`,
      detail: `${overBudgetNote}${skillLabels(typedOnly).join(', ')}. Set to user-invocable-only and the slash command keeps working while the description leaves the prompt.`,
      saves: sumOf(savings),
      fix: skillFixLine(
        typedOnly,
        'skillOverrides in .claude/settings.local.json',
        'skillOverrides in .claude/settings.local.json for your own',
      ),
      actions: skillActions(
        typedOnly,
        'user-invocable-only',
        (skill) => `${skill.name} has only ever been typed as /${skill.name}, never chosen by the model.`,
        savings,
        stuckByPlugin,
      ),
    });
  }

  if (neverUsedSkills.length > 0) {
    const window = overSessions(skillScope(neverUsedSkills[0]));
    const savings = savingsFor(neverUsedSkills);
    findings.push({
      headline: `${neverUsedSkills.length} skill${neverUsedSkills.length === 1 ? '' : 's'} never invoked, either way`,
      detail: `${overBudgetNote}${skillLabels(neverUsedSkills).join(', ')}. Across ${window}.`,
      saves: sumOf(savings),
      fix: skillFixLine(
        neverUsedSkills,
        'set each to off in skillOverrides, or delete the ones you do not recognise',
        'set your own to off in skillOverrides, or delete the ones you do not recognise',
      ),
      actions: skillActions(
        neverUsedSkills,
        'off',
        (skill) =>
          `${skill.name} has not been invoked in ${overSessions(skillScope(skill))}, by you or by the model.`,
        savings,
        stuckByPlugin,
      ),
    });
  }

  const visibleAgents = config.agents.filter((agent) => agent.shadowedBy === null);
  // The record counts the agents the client ships with as well, which appear in no file.
  const agentTokens = record?.agents == null ? measure.agents.tokens : toTokens(record.agents.chars);
  rows.push({
    label: plural(record?.agents == null ? visibleAgents.length : record.agents.items, 'agent'),
    kind: 'agents',
    count: record?.agents == null ? visibleAgents.length : record.agents.items,
    tokens: agentTokens,
    // No second half: the frontmatter is resident and the body is not counted anywhere.
    loadedTokens: null,
    share: share(agentTokens),
    calls: null,
    perCall: null,
    basis: null,
    verdict: { kind: 'not-attributable', why: 'agent listings are not separable from the prompt' },
    fix: null,
  });

  const memoryTokens = record?.instructions == null ? measure.memory.tokens : toTokens(record.instructions.chars);
  rows.push({
    label: plural(record?.instructions == null ? measure.memory.items : record.instructions.files.length, 'memory file'),
    kind: 'memory',
    count: record?.instructions == null ? measure.memory.items : record.instructions.files.length,
    tokens: memoryTokens,
    // No second half: the frontmatter is resident and the body is not counted anywhere.
    loadedTokens: null,
    share: share(memoryTokens),
    calls: null,
    perCall: null,
    basis: null,
    verdict: {
      kind: 'not-attributable',
      why: 'the model reads these, it does not call them, so no log can say which lines were used',
    },
    fix: null,
  });

  /**
   * What Claude Code sends on its own account, and what your hooks add in front of the first turn.
   *
   * 🔑 This is most of what `unattributed` used to be. The client's tool schemas and system prompt
   * are the largest block in a prompt and were invisible to a tool that only reads config, so the
   * biggest row on the screen was the one named "we do not know". A recent client records both.
   * Whatever is still left over stays `unattributed`, and it is mostly the distance between
   * `chars/4` and a real tokenizer on JSON.
   */
  if (record !== null) {
    const clientRow = (
      label: string,
      chars: number,
      kind: 'client' | 'hooks',
      why: string,
      part?: ClientPart,
      count?: number,
    ): void => {
      const tokens = toTokens(chars);
      rows.push({
        label,
        kind,
        ...(part === undefined ? {} : { part }),
        ...(count === undefined ? {} : { count }),
        tokens,
        loadedTokens: null,
        share: share(tokens),
        calls: null,
        perCall: null,
        basis: null,
        verdict: { kind: 'not-attributable', why },
        fix: null,
      });
    };
    const itsOwn = 'sent by Claude Code itself on every turn, so there is nothing here to switch off';
    if (record.hooks !== null) {
      clientRow(
        'your hooks',
        record.hooks.chars,
        'hooks',
        'what your hooks put in front of the first turn. A hook that adds context on every prompt adds this much again each time',
      );
    }
    if (record.builtinTools !== null) {
      clientRow(
        `its ${plural(record.builtinTools.items, 'tool')}`,
        record.builtinTools.chars,
        'client',
        itsOwn,
        'tools',
        record.builtinTools.items,
      );
    }
    if (record.systemPrompt !== null) {
      clientRow('its system prompt', record.systemPrompt.chars, 'client', itsOwn, 'system-prompt');
    }
    if (record.toolList !== null) clientRow('its tool name list', record.toolList.chars, 'client', itsOwn, 'tool-list');
    if (record.sessionDetails !== null) {
      clientRow('its session details', record.sessionDetails.chars, 'client', itsOwn, 'session-details');
    }
  }

  const attributed = rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
  const overAttributed = total !== null && attributed > total;

  return {
    cwd: config.cwd,
    source:
      picked === null
        ? { kind: 'measured' }
        : { kind: 'record', day: picked.day, client: picked.record.client, asSent: picked.record.asSent },
    // Only a listing pinned against its budget proves the window. Nothing else on disk does.
    windowTokens: sentListing?.budget.windowTokens ?? null,
    listingBudget: listingBudgetOffer,
    neverReceived:
      sentListing === null || sentListing.dropped.length === 0
        ? null
        : { dropped: sentListing.dropped.length, listed: sentListing.entries },
    actions: mergeActions(findings.flatMap((finding) => finding.actions)),
    machine: machineTotals(evidence, allSessions),
    reconciliation: {
      total,
      window: windowLabel,
      sessions: sessions.length,
      attributed,
      unattributed: total === null || overAttributed ? null : total - attributed,
      overAttributed,
    },
    rows,
    findings,
    recoverable: findings.reduce((sum, finding) => sum + (finding.saves ?? 0), 0),
    // A verdict about use, not a verdict about why there is no verdict. `too-new`,
    // `never-called-age-unknown`, `broken` and `not-measured` are all the tool declining to say.
    judged:
      rows.some((row) =>
        ['earning-it', 'rarely-called', 'never-called'].includes(row.verdict.kind),
      ) || judgeableSkills.length > 0,
    problems: [
      ...config.problems,
      // 🚨 Said on the main screen, not only in the developer view: every session inside a file
      // that could not be read is missing from every denominator above it, and a denominator that
      // is quietly too small is how a used server gets called dead.
      ...(evidence.unreadable.length === 0
        ? []
        : [
            {
              path: evidence.unreadable[0],
              message:
                `${plural(evidence.unreadable.length, 'session file')} could not be read, so the ` +
                'sessions inside are missing from every count above' +
                (evidence.unreadable.length === 1 ? '' : ' (first of them)'),
            },
          ]),
    ],
  };
}

export type {
  ClientPart,
  EvidenceScope,
  Finding,
  Ledger,
  LedgerRow,
  LedgerSource,
  ListingBudgetOffer,
  MachineEvidence,
  Reconciliation,
  RowKind,
  Verdict,
} from './types.js';
