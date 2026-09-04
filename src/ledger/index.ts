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

import type { Evidence, ProjectEvidence, SessionEvidence } from '../evidence/types.js';
import { actionKey } from '../fix/types.js';
import type { FixAction } from '../fix/types.js';
import { tokens as toTokens } from '../measure/tokens.js';
import type { MeasureResult, MeasuredMcpServer } from '../measure/types.js';
import type {
  ConfiguredSince,
  ResolveResult,
  ResolvedMcpServer,
  ResolvedSkill,
  SkillOverride,
} from '../resolve/types.js';
import type {
  EvidenceScope,
  Finding,
  Ledger,
  LedgerRow,
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
    return measured.status.cause === 'failed'
      ? { kind: 'broken', reason: measured.status.reason }
      : { kind: 'not-measured', reason: measured.status.reason };
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

  const recent = sessions.filter((session) => session.coldStartTokens !== null).slice(0, windowSize);
  const total = median(recent.map((session) => session.coldStartTokens ?? 0));
  const windowLabel =
    recent.length === 0
      ? 'no session here recorded a cold start'
      : `${recent.length} most recent session${recent.length === 1 ? '' : 's'}, ` +
        `${(recent[recent.length - 1].firstSeen ?? '').slice(0, 10)} to ${(recent[0].firstSeen ?? '').slice(0, 10)}`;

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

  /**
   * 🔑 The rule the whole change turns on: **a verdict's denominator must cover everything its fix
   * would switch off.**
   *
   * `claude mcp remove <name> -s user` is machine-wide, so recommending it on this project's
   * silence is a recommendation to break the project next door. Found on a real machine: a server
   * with one call in 152 sessions here, 67 in a sibling repo, and a `-s user` removal printed
   * against it.
   */
  const serverScope = (server: ResolvedMcpServer): EvidenceScope =>
    server.fixLever.kind === 'claude-mcp-remove' && server.fixLever.scope === 'user'
      ? 'machine'
      : thin
        ? 'machine'
        : 'project';

  /** Skills, agents and plugins have no machine-wide lever, so they widen only when starved. */
  const fileScope: EvidenceScope = thin ? 'machine' : 'project';
  const fileUsage = fileScope === 'machine' ? everywhere : here;
  const fileSessions = fileScope === 'machine' ? allSessions.length : sessions.length;
  const { skillModelCalls, skillTypedCalls } = fileUsage;
  /** Never a bare session count. The reader has to be able to see which history it was counted over. */
  const overSessions = (count: number): string =>
    `${count} session${count === 1 ? '' : 's'} ${fileScope === 'machine' ? 'on this machine' : 'here'}`;

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
      (server) => server.plugin === id && (everywhere.calls.get(server.name) ?? 0) > 0,
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
    const used = usage.calls.get(measured.name) ?? 0;
    // Scoped to the same window the verdict uses. A server added last week must not be charged for
    // turns taken before it existed.
    const inWindow = startedSince(scoped, declared.configuredSince) ?? scoped;
    const turns = turnsIn(inWindow);
    // 🔑 Every per-turn number below is the **resident** one. The client defers tool schemas, so
    // charging a server's whole serialized weight to every turn would overstate acme by 3.2x.
    // `measured.tokens` is still the right number for what a load costs, and it rides along.
    const perTurn = measured.residentTokens;
    const perCall = perTurn === null || used === 0 ? null : Math.round((perTurn * turns) / used);
    const verdict = serverVerdict(
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
      loadedTokens: measured.tokens,
      share: share(perTurn),
      calls: used,
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
    if (verdict.kind === 'rarely-called' && perTurn !== null) {
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
    if (verdict.kind === 'never-called' && perTurn !== null) {
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
    const perTool = usage.toolCalls.get(measured.name);
    const unusedTools = measured.tools.filter((tool) => (perTool?.get(tool.name) ?? 0) === 0);
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

  /* Skills, agents and memory are one row each; the per-item recommendation is a finding. */

  /**
   * One skill, one recommendation, routed by where the skill came from.
   *
   * 🔑 `skillOverrides` has **no effect on a plugin skill**. Emitting one anyway would be the worst
   * kind of fix: it writes a file, reports success, and changes nothing. A plugin skill is therefore
   * either folded into a whole-plugin switch — only when nothing that plugin provides has been used
   * — or handed back with the reason there is no lever.
   */
  const skillAction = (skill: ResolvedSkill, value: SkillOverride, why: string): FixAction | null => {
    if (skill.plugin === null) {
      return {
        kind: 'skill-override',
        skill: skill.name,
        value,
        settingsPath: config.settingsTarget,
        why,
        saves: toTokens(skill.listingChars),
      };
    }
    if (pluginIsIdle(skill.plugin)) {
      return {
        kind: 'disable-plugin',
        plugin: skill.plugin,
        // This project's settings file, for the reason spelled out on the `enabledPlugins` lever
        // in `resolve/mcp.ts`: the evidence is repo-scoped, so the edit has to be. Project scope
        // works — this repo's own `.claude/settings.json` already carries an `enabledPlugins` block.
        settingsPath: config.settingsTarget,
        why: `nothing the ${skill.plugin} plugin provides has been used anywhere on this machine`,
        saves: toTokens(skill.listingChars),
      };
    }
    return {
      kind: 'manual',
      command: null,
      why:
        `${skill.name} comes from the ${skill.plugin} plugin, and skillOverrides does not apply to ` +
        'plugin skills. The only switch is the whole plugin, which you do use.',
    };
  };

  const visibleSkills = config.skills.filter((skill) => skill.shadowedBy === null);
  rows.push({
    label: `${visibleSkills.length} skills`,
    kind: 'skills',
    tokens: measure.skills.tokens,
    // No second half: the frontmatter is resident and the body is not counted anywhere.
    loadedTokens: null,
    share: share(measure.skills.tokens),
    calls: visibleSkills.reduce(
      (sum, skill) => sum + callsFor(skillModelCalls, skill.name, skill.plugin),
      0,
    ),
    perCall: null,
    basis: null,
    verdict: {
      kind: 'not-attributable',
      why: 'a skill listing is one line each; the useful unit is the skill, below',
    },
    fix: null,
  });

  const typedOnly = visibleSkills.filter(
    (skill) =>
      callsFor(skillModelCalls, skill.name, skill.plugin) === 0 &&
      callsFor(skillTypedCalls, skill.name, skill.plugin) > 0,
  );
  if (typedOnly.length > 0) {
    findings.push({
      headline: `${typedOnly.length} skill${typedOnly.length === 1 ? '' : 's'} you only ever type, never let the model choose`,
      detail: `${skillLabels(typedOnly).join(', ')}. Set to user-invocable-only and the slash command keeps working while the description leaves the prompt.`,
      saves: toTokens(typedOnly.reduce((sum, skill) => sum + skill.listingChars, 0)),
      // Plugin skills are not affected by skillOverrides, and emitting one would silently do nothing.
      fix: typedOnly.every((skill) => skill.plugin === null)
        ? 'skillOverrides in .claude/settings.local.json'
        : 'skillOverrides in .claude/settings.local.json, except the plugin ones, which need enabledPlugins',
      actions: typedOnly
        .map((skill) =>
          skillAction(
            skill,
            'user-invocable-only',
            `${skill.name} has only ever been typed as /${skill.name}, never chosen by the model.`,
          ),
        )
        .filter((action): action is FixAction => action !== null),
    });
  }

  const neverUsedSkills = visibleSkills.filter(
    (skill) =>
      callsFor(skillModelCalls, skill.name, skill.plugin) === 0 &&
      callsFor(skillTypedCalls, skill.name, skill.plugin) === 0,
  );
  if (neverUsedSkills.length > 0) {
    findings.push({
      headline: `${neverUsedSkills.length} skill${neverUsedSkills.length === 1 ? '' : 's'} never invoked, either way`,
      detail: `${skillLabels(neverUsedSkills).join(', ')}. Across ${overSessions(fileSessions)}.`,
      saves: toTokens(neverUsedSkills.reduce((sum, skill) => sum + skill.listingChars, 0)),
      fix: 'set each to off in skillOverrides, or delete the ones you do not recognise',
      actions: neverUsedSkills
        .map((skill) =>
          skillAction(
            skill,
            'off',
            `${skill.name} has not been invoked in ${overSessions(fileSessions)}, by you or by the model.`,
          ),
        )
        .filter((action): action is FixAction => action !== null),
    });
  }

  const visibleAgents = config.agents.filter((agent) => agent.shadowedBy === null);
  rows.push({
    label: `${visibleAgents.length} agents`,
    kind: 'agents',
    tokens: measure.agents.tokens,
    // No second half: the frontmatter is resident and the body is not counted anywhere.
    loadedTokens: null,
    share: share(measure.agents.tokens),
    calls: null,
    perCall: null,
    basis: null,
    verdict: { kind: 'not-attributable', why: 'agent listings are not separable from the prompt' },
    fix: null,
  });

  rows.push({
    label: `${measure.memory.items} memory files`,
    kind: 'memory',
    tokens: measure.memory.tokens,
    // No second half: the frontmatter is resident and the body is not counted anywhere.
    loadedTokens: null,
    share: share(measure.memory.tokens),
    calls: null,
    perCall: null,
    basis: null,
    verdict: {
      kind: 'not-attributable',
      why: 'the model reads these, it does not call them, so no log can say which lines were used',
    },
    fix: null,
  });

  const attributed = rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
  const overAttributed = total !== null && attributed > total;

  return {
    cwd: config.cwd,
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
    problems: [...config.problems],
  };
}

export type {
  EvidenceScope,
  Finding,
  Ledger,
  LedgerRow,
  MachineEvidence,
  Reconciliation,
  RowKind,
  Verdict,
} from './types.js';
