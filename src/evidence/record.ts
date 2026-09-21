/**
 * Reading what a session sent, out of the `attachment` lines of its transcript.
 *
 * See `SentRecord` for what this is and why it beats a model of the client. This file is the
 * parser, and it holds the two rules that make reading an undocumented format safe:
 *
 *  1. **Nothing here throws, and nothing here guesses.** A field of the wrong type is a field that
 *     is not there. A part with no usable field stays `null`, and a `null` part sends its row back
 *     to the measure pass rather than printing a zero.
 *  2. 🔒 **Text is measured and dropped on the spot.** These lines carry every skill description
 *     and the whole of every CLAUDE.md. What leaves this file is lengths, counts, skill names and
 *     file paths, which are all things the rest of the tool already prints.
 */

import { parseMcpToolName, toolPrefixName } from './names.js';
import type { SentPart, SentRecord, SentServer, SentSkill, SentSkillListing } from './types.js';

/** Cheap substring gate, applied before `JSON.parse`, the same way the scan gates every line. */
export const ATTACHMENT_HINT = '"type":"attachment"';

const TYPE_MARK = '"attachment":{"type":"';

/** Injected by hooks. Only the ones a hook hands to the model carry rendered text. */
const HOOK_TYPES = new Set(['hook_additional_context', 'hook_success']);

/**
 * The small fixed blocks the client adds on its own.
 *
 * 🔑 An allowlist, on purpose. A transcript also attaches files the user dragged in, edits, queued
 * prompts and nested memory, and those are conversation, not prefix. A list that goes stale lets a
 * new block fall into the remainder, which is honest. A denylist that goes stale would count
 * somebody's pasted file as a fixed cost, which is not.
 */
const DETAIL_TYPES = new Set([
  'environment',
  'model',
  'date',
  'session_context',
  'remote_session_change',
  'auto_mode',
  'total_tokens_reminder',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** The attachment's type, read without parsing the line. `null` when the layout is not the usual one. */
export function sniffAttachmentType(line: string): string | null {
  const at = line.indexOf(TYPE_MARK);
  if (at === -1) return null;
  const start = at + TYPE_MARK.length;
  const end = line.indexOf('"', start);
  return end === -1 ? null : line.slice(start, end);
}

/** `rendered` is the text as the model received it: `[{ content }]`. `null` on an older client. */
function renderedChars(rendered: unknown): number | null {
  if (!Array.isArray(rendered)) return null;
  let chars = 0;
  let found = false;
  for (const block of rendered) {
    const content = asRecord(block)?.content;
    if (typeof content !== 'string') continue;
    chars += content.length;
    found = true;
  }
  return found ? chars : null;
}

export interface RecordAccumulator {
  client: string | null;
  /** A part that should have carried its rendered text and did not: an older client wrote this. */
  unrendered: boolean;
  skillListing: SentSkillListing | null;
  instructions: { chars: number; files: { path: string; chars: number }[] } | null;
  agents: SentPart | null;
  /** Tool name to the characters of its line. A map, because a compaction re-sends the whole list. */
  toolLines: Map<string, number>;
  sawToolList: boolean;
  /** The lines around the lists, taken from the first of each only. */
  framingChars: number;
  serverInstructions: Map<string, number>;
  serverSchemas: Map<string, { tools: number; chars: number }>;
  failedServers: Set<string>;
  hooks: SentPart | null;
  sessionDetails: SentPart | null;
  systemPrompt: SentPart | null;
  builtinTools: SentPart | null;
}

export function newRecordAccumulator(): RecordAccumulator {
  return {
    client: null,
    unrendered: false,
    skillListing: null,
    instructions: null,
    agents: null,
    toolLines: new Map(),
    sawToolList: false,
    framingChars: 0,
    serverInstructions: new Map(),
    serverSchemas: new Map(),
    failedServers: new Set(),
    hooks: null,
    sessionDetails: null,
    systemPrompt: null,
    builtinTools: null,
  };
}

/**
 * Is this attachment line worth parsing?
 *
 * A snapshot of the client's tool schemas is a hundred thousand characters and is written again
 * after every compaction. Parsing each one across nine hundred transcripts would double the scan to
 * learn a number the first one already gave, so anything already held is skipped unparsed.
 */
export function wantsAttachment(acc: RecordAccumulator, line: string, beforeFirstTurn: boolean): boolean {
  const type = sniffAttachmentType(line);
  // An unfamiliar layout is parsed and left to `recordAttachment`, which tolerates anything.
  if (type === null) return true;
  switch (type) {
    case 'skill_listing':
      return acc.skillListing === null;
    case 'instructions':
      return acc.instructions === null;
    case 'agent_listing_delta':
      return acc.agents === null;
    case 'deferred_tools_delta':
    case 'mcp_instructions_delta':
      return true;
    case 'prompt_snapshot':
      return acc.systemPrompt === null || (acc.builtinTools === null && line.includes('"tools":['));
    default:
      return beforeFirstTurn && (HOOK_TYPES.has(type) || DETAIL_TYPES.has(type));
  }
}

/**
 * The listing, line by line.
 *
 * Each entry is `- name: description`, or `- name` alone once the budget has taken the description.
 * A description can run over several lines, and one of those lines can itself begin `- `, so an
 * entry starts only where the text after the dash is a name the client says it listed.
 */
export function parseSkillListing(content: string, names: string[]): SentSkill[] {
  const known = new Set(names);
  const skills: SentSkill[] = [];
  const seen = new Set<string>();
  let current: SentSkill | null = null;
  for (const line of content.split('\n')) {
    let started: SentSkill | null = null;
    if (line.startsWith('- ')) {
      const rest = line.slice(2);
      const cut = rest.indexOf(': ');
      const name = cut === -1 ? rest : rest.slice(0, cut);
      // With no name list to check against, every dash line is taken as an entry.
      if ((known.size === 0 || known.has(name)) && !seen.has(name)) {
        started = { name, described: cut !== -1, chars: line.length };
      }
    }
    if (started !== null) {
      seen.add(started.name);
      skills.push(started);
      current = started;
    } else if (current !== null) {
      // The rest of a description that ran past one line, newline included.
      current.chars += line.length + 1;
    }
  }
  return skills;
}

function addTo(part: SentPart | null, chars: number): SentPart {
  return part === null ? { chars, items: 1 } : { chars: part.chars + chars, items: part.items + 1 };
}

function recordSkillListing(acc: RecordAccumulator, attachment: Record<string, unknown>, sent: number | null): void {
  // A later listing that only adds to the first is not the listing, and would read as a short one.
  if (attachment.isInitial === false) return;
  const content = asString(attachment.content);
  if (content === null) return;
  const skills = parseSkillListing(content, strings(attachment.names));
  if (skills.length === 0) return;
  if (sent === null) acc.unrendered = true;
  acc.skillListing = {
    chars: sent ?? content.length,
    listChars: content.length,
    entries: skills.length,
    bare: skills.filter((skill) => !skill.described).length,
    skills,
  };
}

function recordInstructions(acc: RecordAccumulator, attachment: Record<string, unknown>, sent: number | null): void {
  if (!Array.isArray(attachment.files)) return;
  const files: { path: string; chars: number }[] = [];
  for (const entry of attachment.files) {
    const file = asRecord(entry);
    const path = file === null ? null : asString(file.path);
    if (file === null || path === null) continue;
    // 🔒 The length is taken and the text goes no further than this line.
    files.push({ path, chars: typeof file.content === 'string' ? file.content.length : 0 });
  }
  if (files.length === 0) return;
  if (sent === null) acc.unrendered = true;
  acc.instructions = { chars: sent ?? files.reduce((sum, file) => sum + file.chars, 0), files };
}

function recordAgents(acc: RecordAccumulator, attachment: Record<string, unknown>, sent: number | null): void {
  if (attachment.isInitial === false) return;
  const lines = strings(attachment.addedLines);
  if (lines.length === 0) return;
  if (sent === null) acc.unrendered = true;
  acc.agents = {
    chars: sent ?? lines.reduce((sum, line) => sum + line.length + 1, 0),
    items: lines.length,
  };
}

function recordToolList(acc: RecordAccumulator, attachment: Record<string, unknown>, sent: number | null): void {
  const names = strings(attachment.addedNames);
  const lines = strings(attachment.addedLines);
  let listed = 0;
  names.forEach((name, index) => {
    const chars = (lines[index] ?? name).length + 1;
    listed += chars;
    acc.toolLines.set(name, chars);
  });
  for (const name of strings(attachment.removedNames)) acc.toolLines.delete(name);
  if (Array.isArray(attachment.failedMcpServers)) {
    for (const failed of attachment.failedMcpServers) {
      const name = asString(asRecord(failed)?.name);
      if (name !== null) acc.failedServers.add(name);
    }
  }
  if (!acc.sawToolList && names.length > 0) {
    acc.sawToolList = true;
    if (sent === null) acc.unrendered = true;
    else acc.framingChars += Math.max(0, sent - listed);
  }
}

function recordServerInstructions(
  acc: RecordAccumulator,
  attachment: Record<string, unknown>,
  sent: number | null,
): void {
  const names = strings(attachment.addedNames);
  const blocks = strings(attachment.addedBlocks);
  const first = acc.serverInstructions.size === 0;
  let listed = 0;
  names.forEach((name, index) => {
    const chars = (blocks[index] ?? '').length;
    listed += chars;
    acc.serverInstructions.set(toolPrefixName(name), chars);
  });
  for (const name of strings(attachment.removedNames)) acc.serverInstructions.delete(toolPrefixName(name));
  if (first && names.length > 0 && sent !== null) acc.framingChars += Math.max(0, sent - listed);
}

function recordSnapshot(acc: RecordAccumulator, attachment: Record<string, unknown>): void {
  if (acc.systemPrompt === null && Array.isArray(attachment.systemPrompt)) {
    const blocks = attachment.systemPrompt;
    const chars = blocks.reduce<number>(
      (sum, block) => sum + (typeof block === 'string' ? block.length : JSON.stringify(block ?? '').length),
      0,
    );
    if (chars > 0) acc.systemPrompt = { chars, items: blocks.length };
  }
  if (acc.builtinTools !== null || !Array.isArray(attachment.tools)) return;
  let own: SentPart = { chars: 0, items: 0 };
  for (const entry of attachment.tools) {
    const tool = asRecord(entry);
    const name = tool === null ? null : asString(tool.name);
    if (tool === null || name === null) continue;
    // The three fields a tool definition has on the API, which is what the model is sent. The
    // snapshot files the schema under `schema`; the other two spellings are what the API and MCP
    // call it, accepted because a format nobody documents is a format nobody promised to keep.
    const chars = JSON.stringify({
      name,
      description: typeof tool.description === 'string' ? tool.description : '',
      input_schema: tool.schema ?? tool.input_schema ?? tool.inputSchema ?? {},
    }).length;
    const mcp = parseMcpToolName(name);
    if (mcp === null) {
      own = { chars: own.chars + chars, items: own.items + 1 };
      continue;
    }
    const held = acc.serverSchemas.get(mcp.server) ?? { tools: 0, chars: 0 };
    acc.serverSchemas.set(mcp.server, { tools: held.tools + 1, chars: held.chars + chars });
  }
  if (own.items > 0) acc.builtinTools = own;
}

/** One parsed `attachment` line. Anything it does not recognise is left alone. */
export function recordAttachment(
  acc: RecordAccumulator,
  line: Record<string, unknown>,
  beforeFirstTurn: boolean,
): void {
  const attachment = asRecord(line.attachment);
  const type = attachment === null ? null : asString(attachment.type);
  if (attachment === null || type === null) return;
  acc.client ??= asString(line.version);
  const sent = renderedChars(line.rendered);

  switch (type) {
    case 'skill_listing':
      if (acc.skillListing === null) recordSkillListing(acc, attachment, sent);
      return;
    case 'instructions':
      if (acc.instructions === null) recordInstructions(acc, attachment, sent);
      return;
    case 'agent_listing_delta':
      if (acc.agents === null) recordAgents(acc, attachment, sent);
      return;
    case 'deferred_tools_delta':
      recordToolList(acc, attachment, sent);
      return;
    case 'mcp_instructions_delta':
      recordServerInstructions(acc, attachment, sent);
      return;
    case 'prompt_snapshot':
      recordSnapshot(acc, attachment);
      return;
    default:
      // Only what rode in front of the first turn is prefix. After it, the same block is the
      // conversation growing, which the billed total already counts and no row should claim.
      if (!beforeFirstTurn || sent === null) return;
      if (HOOK_TYPES.has(type)) acc.hooks = addTo(acc.hooks, sent);
      else if (DETAIL_TYPES.has(type)) acc.sessionDetails = addTo(acc.sessionDetails, sent);
  }
}

export function finalizeRecord(acc: RecordAccumulator): SentRecord | null {
  const servers: Record<string, SentServer> = {};
  const serverAt = (name: string): SentServer => {
    servers[name] ??= { tools: 0, nameChars: 0, instructionChars: 0, schemaChars: 0 };
    return servers[name];
  };

  let ownTools: SentPart = { chars: acc.framingChars, items: 0 };
  for (const [name, chars] of acc.toolLines) {
    const mcp = parseMcpToolName(name);
    if (mcp === null) {
      ownTools = { chars: ownTools.chars + chars, items: ownTools.items + 1 };
      continue;
    }
    const server = serverAt(mcp.server);
    server.tools += 1;
    server.nameChars += chars;
  }
  for (const [name, chars] of acc.serverInstructions) serverAt(name).instructionChars += chars;
  for (const [name, loaded] of acc.serverSchemas) {
    const server = serverAt(name);
    server.schemaChars += loaded.chars;
    // Loaded up front, so it is in no deferred list and its tools have not been counted yet.
    if (server.tools === 0) server.tools = loaded.tools;
  }

  const record: SentRecord = {
    client: acc.client,
    asSent: !acc.unrendered,
    skillListing: acc.skillListing,
    instructions: acc.instructions,
    agents: acc.agents,
    toolList: acc.sawToolList ? ownTools : null,
    servers,
    // A server that failed the first handshake and connected on a later one did send something.
    failedServers: [...acc.failedServers].filter((name) => servers[toolPrefixName(name)] === undefined),
    hooks: acc.hooks,
    sessionDetails: acc.sessionDetails,
    systemPrompt: acc.systemPrompt,
    builtinTools: acc.builtinTools,
  };

  const empty =
    record.skillListing === null &&
    record.instructions === null &&
    record.agents === null &&
    record.toolList === null &&
    record.hooks === null &&
    record.sessionDetails === null &&
    record.systemPrompt === null &&
    record.builtinTools === null &&
    Object.keys(servers).length === 0;
  return empty ? null : record;
}

