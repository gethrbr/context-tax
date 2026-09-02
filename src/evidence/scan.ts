/**
 * The streaming pass over local session history.
 *
 * Every number this produces is **measured, not estimated**. Per-turn context comes from the
 * `usage` block the API returned, so `input + cache_creation + cache_read` is exactly what was
 * billed for that request. Call counts come from the `tool_use` blocks the model actually emitted.
 * Nothing here infers, and nothing here needs a model.
 *
 * Two properties this has to hold on a real corpus (2.2 GB, ~900 files, measured):
 *
 * 1. **Bounded memory.** Files are streamed a line at a time, never read whole.
 * 2. **A corrupt line is data, not an exception.** Transcripts are appended to by a live process
 *    and can be truncated mid-write. One bad line must never abort a scan over 900 files, so they
 *    are counted and reported instead.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type {
  ColdStart,
  Evidence,
  McpServerUsage,
  ProjectEvidence,
  SessionEvidence,
  SkillUsage,
} from './types.js';
import { defaultProjectsDir, findTranscripts, type TranscriptKind } from './transcripts.js';

/**
 * Cheap substring gate applied before `JSON.parse`. Most lines in a transcript are neither an
 * assistant turn nor a typed command, and parsing them is the difference between a scan that takes
 * a minute and one that takes ten.
 */
const ASSISTANT_HINT = '"type":"assistant"';
const COMMAND_HINT = '<command-name>';

const COMMAND_PATTERN = /<command-name>\s*\/?([A-Za-z0-9_:.-]+)\s*<\/command-name>/g;

export interface ScanOptions {
  /** Defaults to `~/.claude/projects`. */
  projectsDir?: string;
  /** Ignore sessions whose last record predates this. */
  since?: Date;
  /** Restrict to sessions whose recorded `cwd` is this directory or below it. */
  cwd?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** `mcp__acme__acme_get_knowledge` → `{ server: 'acme', tool: 'acme_get_knowledge' }`. */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith('mcp__')) return null;
  const rest = name.slice('mcp__'.length);
  const split = rest.indexOf('__');
  if (split <= 0 || split === rest.length - 2) return null;
  return { server: rest.slice(0, split), tool: rest.slice(split + 2) };
}

/** Pulls every `<command-name>` out of a user message, whose content may be a string or blocks. */
export function extractSlashCommands(content: unknown): string[] {
  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((block) => {
        const record = asRecord(block);
        return record && typeof record.text === 'string' ? record.text : '';
      })
      .join('\n');
  } else {
    return [];
  }

  const found: string[] = [];
  for (const match of text.matchAll(COMMAND_PATTERN)) found.push(match[1]);
  return found;
}

/** Mutable per-session accumulator. Flattened into `SessionEvidence` when the file ends. */
interface SessionAccumulator {
  session: SessionEvidence;
  mcpServers: Map<string, { calls: number; tools: Map<string, number> }>;
  builtinTools: Map<string, number>;
  skills: Map<string, SkillUsage>;
  agents: Map<string, number>;
  slashCommands: Map<string, number>;
}

function bump<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function recordToolUse(acc: SessionAccumulator, name: string, input: Record<string, unknown> | null): void {
  const mcp = parseMcpToolName(name);
  if (mcp) {
    let entry = acc.mcpServers.get(mcp.server);
    if (!entry) {
      entry = { calls: 0, tools: new Map() };
      acc.mcpServers.set(mcp.server, entry);
    }
    entry.calls += 1;
    bump(entry.tools, mcp.tool);
    return;
  }

  bump(acc.builtinTools, name);

  if (name === 'Skill') {
    const skill = input ? asString(input.skill) : null;
    if (skill) {
      const usage = acc.skills.get(skill) ?? { model: 0, user: 0 };
      usage.model += 1;
      acc.skills.set(skill, usage);
    }
    return;
  }

  if (name === 'Agent') {
    const type = input ? asString(input.subagent_type) : null;
    if (type) bump(acc.agents, type);
  }
}

async function scanFile(
  path: string,
  slug: string,
  kind: TranscriptKind,
): Promise<{ acc: SessionAccumulator; malformed: number }> {
  const acc: SessionAccumulator = {
    session: {
      sessionId: slug,
      file: path,
      kind,
      cwd: null,
      turns: 0,
      sidechainTurns: 0,
      coldStartTokens: null,
      contextTokens: 0,
      outputTokens: 0,
      firstSeen: null,
      lastSeen: null,
    },
    mcpServers: new Map(),
    builtinTools: new Map(),
    skills: new Map(),
    agents: new Map(),
    slashCommands: new Map(),
  };
  let malformed = 0;

  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    const isAssistant = line.includes(ASSISTANT_HINT);
    const hasCommand = line.includes(COMMAND_HINT);
    if (!isAssistant && !hasCommand) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    const record = asRecord(parsed);
    if (!record) continue;

    const sessionId = asString(record.sessionId);
    if (sessionId) acc.session.sessionId = sessionId;
    const cwd = asString(record.cwd);
    if (cwd && !acc.session.cwd) acc.session.cwd = cwd;
    const timestamp = asString(record.timestamp);
    if (timestamp) {
      if (!acc.session.firstSeen) acc.session.firstSeen = timestamp;
      acc.session.lastSeen = timestamp;
    }

    const message = asRecord(record.message);

    if (record.type === 'user' && message) {
      for (const command of extractSlashCommands(message.content)) bump(acc.slashCommands, command);
      continue;
    }

    if (record.type !== 'assistant' || !message) continue;

    const usage = asRecord(message.usage);
    if (usage) {
      const cacheRead = asNumber(usage.cache_read_input_tokens);
      const total = asNumber(usage.input_tokens) + asNumber(usage.cache_creation_input_tokens) + cacheRead;
      if (total > 0) {
        acc.session.turns += 1;
        acc.session.contextTokens += total;
        acc.session.outputTokens += asNumber(usage.output_tokens);
        // The FILE decides this, not a record field: `isSidechain` never appears as `true`
        // anywhere in a real corpus, because a subagent's turns live in their own transcript.
        if (kind === 'subagent' || record.isSidechain === true) acc.session.sidechainTurns += 1;
        // A request that read nothing from cache carried the whole prompt, so its total IS the
        // fixed prefix plus the first user message. Later turns cannot tell us that.
        if (cacheRead === 0 && acc.session.coldStartTokens === null) {
          acc.session.coldStartTokens = total;
        }
      }
    }

    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const blockRecord = asRecord(block);
      if (!blockRecord || blockRecord.type !== 'tool_use') continue;
      const name = asString(blockRecord.name);
      if (name) recordToolUse(acc, name, asRecord(blockRecord.input));
    }
  }

  return { acc, malformed };
}

/** Mutable per-project accumulator. */
interface ProjectAccumulator {
  cwd: string;
  sessions: number;
  turns: number;
  sidechainTurns: number;
  contextTokens: number;
  outputTokens: number;
  coldStarts: number[];
  firstSeen: string | null;
  lastSeen: string | null;
  mcpServers: Map<string, { calls: number; sessions: number; tools: Map<string, number> }>;
  builtinTools: Map<string, number>;
  skills: Map<string, SkillUsage>;
  agents: Map<string, number>;
  slashCommands: Map<string, number>;
}

function mergeSession(
  project: ProjectAccumulator,
  acc: SessionAccumulator,
  kind: TranscriptKind,
): void {
  const { session } = acc;
  // 🔑 A subagent's turns are billed and its tool calls are real usage, so both count. But it is
  // not a session a human started, and its prefix is a different one — folding it into the session
  // count would inflate it, and into the cold-start median would bias the number the whole ledger
  // is built on.
  if (kind === 'session') {
    project.sessions += 1;
    if (session.coldStartTokens !== null) project.coldStarts.push(session.coldStartTokens);
  }
  project.turns += session.turns;
  project.sidechainTurns += session.sidechainTurns;
  project.contextTokens += session.contextTokens;
  project.outputTokens += session.outputTokens;
  if (session.firstSeen && (!project.firstSeen || session.firstSeen < project.firstSeen)) {
    project.firstSeen = session.firstSeen;
  }
  if (session.lastSeen && (!project.lastSeen || session.lastSeen > project.lastSeen)) {
    project.lastSeen = session.lastSeen;
  }

  for (const [server, usage] of acc.mcpServers) {
    let entry = project.mcpServers.get(server);
    if (!entry) {
      entry = { calls: 0, sessions: 0, tools: new Map() };
      project.mcpServers.set(server, entry);
    }
    entry.calls += usage.calls;
    // One session that called it counts once, however many calls it made.
    entry.sessions += 1;
    for (const [tool, calls] of usage.tools) bump(entry.tools, tool, calls);
  }
  for (const [name, calls] of acc.builtinTools) bump(project.builtinTools, name, calls);
  for (const [name, calls] of acc.agents) bump(project.agents, name, calls);
  for (const [name, calls] of acc.slashCommands) bump(project.slashCommands, name, calls);
  for (const [name, usage] of acc.skills) {
    const existing = project.skills.get(name) ?? { model: 0, user: 0 };
    existing.model += usage.model;
    existing.user += usage.user;
    project.skills.set(name, existing);
  }
}

function fromMap<V, R>(map: Map<string, V>, transform: (value: V) => R): Record<string, R> {
  const out: Record<string, R> = {};
  for (const [key, value] of map) out[key] = transform(value);
  return out;
}

function finalizeColdStart(values: number[]): ColdStart | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, median: median(sorted), min: sorted[0], max: sorted[sorted.length - 1] };
}

export async function scanEvidence(options: ScanOptions = {}): Promise<Evidence> {
  const projectsDir = options.projectsDir ?? defaultProjectsDir();
  // Narrow to the buckets that could hold this directory's sessions. The slug mapping is the one
  // documented in `transcripts.ts`: every `/` becomes `-`. It is lossy, so this can only ever be a
  // pre-filter; the real `cwd` filter below is what decides. Skipping the rest of the corpus is
  // what makes the ledger a two-second command instead of a one-minute one.
  const files = await findTranscripts(
    projectsDir,
    options.cwd === undefined ? undefined : options.cwd.replace(/\//g, '-'),
  );
  const sinceIso = options.since?.toISOString() ?? null;

  const sessions: SessionEvidence[] = [];
  const projects = new Map<string, ProjectAccumulator>();
  let malformedLines = 0;
  let scannedFiles = 0;

  for (const file of files) {
    const { acc, malformed } = await scanFile(file.path, file.slug, file.kind);
    malformedLines += malformed;
    scannedFiles += 1;

    if (acc.session.turns === 0 && acc.slashCommands.size === 0) continue;
    if (sinceIso && acc.session.lastSeen && acc.session.lastSeen < sinceIso) continue;

    const cwd = acc.session.cwd;
    if (options.cwd && (!cwd || !(cwd === options.cwd || cwd.startsWith(`${options.cwd}/`)))) continue;

    sessions.push(acc.session);

    // A session with no recorded cwd cannot be attributed to a project. It still counts in the
    // session list, but it must not silently join a project it may not belong to.
    if (!cwd) continue;
    let project = projects.get(cwd);
    if (!project) {
      project = {
        cwd,
        sessions: 0,
        turns: 0,
        sidechainTurns: 0,
        contextTokens: 0,
        outputTokens: 0,
        coldStarts: [],
        firstSeen: null,
        lastSeen: null,
        mcpServers: new Map(),
        builtinTools: new Map(),
        skills: new Map(),
        agents: new Map(),
        slashCommands: new Map(),
      };
      projects.set(cwd, project);
    }
    mergeSession(project, acc, file.kind);
  }

  const projectEvidence: ProjectEvidence[] = [...projects.values()]
    .map((project) => ({
      cwd: project.cwd,
      sessions: project.sessions,
      turns: project.turns,
      sidechainTurns: project.sidechainTurns,
      contextTokens: project.contextTokens,
      outputTokens: project.outputTokens,
      coldStart: finalizeColdStart(project.coldStarts),
      firstSeen: project.firstSeen,
      lastSeen: project.lastSeen,
      mcpServers: fromMap(
        project.mcpServers,
        (value): McpServerUsage => ({
          calls: value.calls,
          sessions: value.sessions,
          tools: Object.fromEntries(value.tools),
        }),
      ),
      builtinTools: Object.fromEntries(project.builtinTools),
      skills: fromMap(project.skills, (value) => ({ ...value })),
      agents: Object.fromEntries(project.agents),
      slashCommands: Object.fromEntries(project.slashCommands),
    }))
    .sort((a, b) => b.turns - a.turns);

  return { scannedFiles, malformedLines, sessions, projects: projectEvidence };
}
