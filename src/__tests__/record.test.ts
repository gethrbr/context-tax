/**
 * Reading what a session sent.
 *
 * 🔒 Every transcript here is invented. The format is Claude Code's own and undocumented, so these
 * fixtures are written to the shapes observed on a real machine and never copied from one: a real
 * `attachment` line holds somebody's CLAUDE.md and every skill description they have.
 *
 * Two kinds of test. The parser is pure and is tested directly. Everything about *which* lines
 * count is a property of the scan, so those go through `scanEvidence` on a temp directory, the same
 * way `scan.test.ts` does.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSkillListing, scanEvidence, transcriptKeysFor } from '../evidence/index.js';
import {
  finalizeRecord,
  newRecordAccumulator,
  recordAttachment,
  sniffAttachmentType,
  wantsAttachment,
} from '../evidence/record.js';
import { downsample, readSessionSeries, summarize } from '../evidence/series.js';

const SECRET_DESCRIPTION = 'Deploys the storefront to the staging cluster when asked to ship';
const SECRET_INSTRUCTIONS = 'Never push to the payments service without asking Dana first';

function attachment(body: Record<string, unknown>, rendered?: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    attachment: body,
    type: 'attachment',
    timestamp: '2026-09-01T09:59:00.000Z',
    ...(rendered === undefined ? {} : { rendered: [{ content: rendered }] }),
    entrypoint: 'cli',
    cwd: '/repo',
    sessionId: 's1',
    version: '2.1.300',
    ...extra,
  });
}

function reply(id: string, context: number, content: unknown[] = [], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    cwd: '/repo',
    timestamp: '2026-09-01T10:00:00.000Z',
    ...extra,
    message: {
      id,
      content,
      usage: { input_tokens: 0, cache_creation_input_tokens: context, cache_read_input_tokens: 0, output_tokens: 1 },
    },
  });
}

const LISTING = [
  'The following skills are available:',
  '',
  `- ship: ${SECRET_DESCRIPTION}`,
  '- acme:audit',
  '- notes: Takes notes.',
  '- keeps bullets like this one',
  '- bare-one',
].join('\n');

const LISTING_NAMES = ['ship', 'acme:audit', 'notes', 'bare-one'];

async function scanLines(lines: string[], file = 'session.jsonl') {
  const root = await mkdtemp(join(tmpdir(), 'context-tax-record-'));
  await mkdir(join(root, '-repo'), { recursive: true });
  await writeFile(join(root, '-repo', file), `${lines.join('\n')}\n`);
  return { evidence: await scanEvidence({ projectsDir: root }), path: join(root, '-repo', file) };
}

describe('the skill listing, line by line', () => {
  it('tells a name sent alone from a name sent with its description', () => {
    const skills = parseSkillListing(LISTING, LISTING_NAMES);
    expect(skills.map((skill) => [skill.name, skill.described])).toEqual([
      ['ship', true],
      ['acme:audit', false],
      ['notes', true],
      ['bare-one', false],
    ]);
  });

  it('keeps a plugin skill whole: the colon in its name is not where the description starts', () => {
    const [skill] = parseSkillListing('- acme:audit: Audits the thing.', ['acme:audit']);
    expect(skill).toMatchObject({ name: 'acme:audit', described: true });
  });

  it('🚨 does not take a bullet inside a description for a skill of its own', () => {
    // The line after `notes` begins `- ` at the margin, exactly as an entry does. Only a name the
    // client says it listed starts one, so this is the rest of a description and not a fifth skill.
    const skills = parseSkillListing(LISTING, LISTING_NAMES);
    expect(skills).toHaveLength(4);
    const notes = skills.find((skill) => skill.name === 'notes');
    expect(notes?.chars).toBe('- notes: Takes notes.'.length + '- keeps bullets like this one'.length + 1);
  });

  it('sizes a bare line as the dash, the space and the name', () => {
    const bare = parseSkillListing(LISTING, LISTING_NAMES).find((skill) => skill.name === 'bare-one');
    expect(bare?.chars).toBe('- bare-one'.length);
  });
});

describe('the names a transcript gives a server', () => {
  it('covers the declared name, its tool-prefix form, and the plugin form', () => {
    expect(transcriptKeysFor('acme', null)).toEqual(['acme']);
    expect(transcriptKeysFor('my.server', null)).toEqual(['my.server', 'my_server']);
    expect(transcriptKeysFor('acme', 'acme-tools@market')).toEqual(['acme', 'plugin_acme-tools_acme']);
  });
});

describe('sniffing a line before parsing it', () => {
  it('reads the attachment type off the raw text', () => {
    expect(sniffAttachmentType(attachment({ type: 'skill_listing', content: 'x' }))).toBe('skill_listing');
    expect(sniffAttachmentType('{"type":"user"}')).toBeNull();
  });
});

describe('what a session sent', () => {
  it('sizes each block by the text as sent, when the client recorded it', async () => {
    const { evidence } = await scanLines([
      attachment({ type: 'skill_listing', content: LISTING, skillCount: 4, isInitial: true, names: LISTING_NAMES }, `<w>${LISTING}</w>`),
      attachment(
        { type: 'instructions', files: [{ path: '/repo/CLAUDE.md', type: 'project', content: SECRET_INSTRUCTIONS }] },
        `<w>${SECRET_INSTRUCTIONS}</w>`,
      ),
      attachment({ type: 'agent_listing_delta', addedTypes: ['a', 'b'], addedLines: ['- a: does a', '- b: does b'], isInitial: true }, 'x'.repeat(40)),
      reply('m1', 50_000),
    ]);
    const record = evidence.sessions[0].record;
    expect(record?.asSent).toBe(true);
    expect(record?.client).toBe('2.1.300');
    expect(record?.skillListing).toMatchObject({ chars: LISTING.length + 7, listChars: LISTING.length, entries: 4, bare: 2 });
    expect(record?.instructions).toEqual({
      chars: SECRET_INSTRUCTIONS.length + 7,
      files: [{ path: '/repo/CLAUDE.md', chars: SECRET_INSTRUCTIONS.length }],
    });
    expect(record?.agents).toEqual({ chars: 40, items: 2 });
  });

  it('falls back to the fields, and says so, for a client that did not record the text as sent', async () => {
    const { evidence } = await scanLines([
      attachment({ type: 'skill_listing', content: LISTING, skillCount: 4, isInitial: true, names: LISTING_NAMES }),
      reply('m1', 50_000),
    ]);
    const record = evidence.sessions[0].record;
    expect(record?.asSent).toBe(false);
    expect(record?.skillListing?.chars).toBe(LISTING.length);
  });

  it('🔒 keeps no description and no instruction text, anywhere in the evidence', async () => {
    const { evidence } = await scanLines([
      attachment({ type: 'skill_listing', content: LISTING, skillCount: 4, isInitial: true, names: LISTING_NAMES }, LISTING),
      attachment(
        { type: 'instructions', files: [{ path: '/repo/CLAUDE.md', type: 'project', content: SECRET_INSTRUCTIONS }] },
        SECRET_INSTRUCTIONS,
      ),
      reply('m1', 50_000),
    ]);
    const everything = JSON.stringify(evidence);
    expect(everything).toContain('/repo/CLAUDE.md');
    expect(everything).not.toContain(SECRET_DESCRIPTION);
    expect(everything).not.toContain(SECRET_INSTRUCTIONS);
    expect(everything).not.toContain('Takes notes');
  });

  it('splits the tool list by server, and keeps what belongs to none of them', async () => {
    const names = ['Monitor', 'mcp__acme__search', 'mcp__acme__fetch', 'mcp__plugin_kit_db__query'];
    const listed = names.reduce((sum, name) => sum + name.length + 1, 0);
    const { evidence } = await scanLines([
      attachment({ type: 'deferred_tools_delta', addedNames: names, addedLines: names, removedNames: [] }, 'y'.repeat(listed + 100)),
      attachment({ type: 'mcp_instructions_delta', addedNames: ['acme', 'my.server'], addedBlocks: ['a'.repeat(300), 'b'.repeat(50)] }, 'z'.repeat(360)),
      reply('m1', 50_000),
    ]);
    const record = evidence.sessions[0].record;
    expect(record?.servers.acme).toEqual({
      tools: 2,
      nameChars: 'mcp__acme__search'.length + 1 + 'mcp__acme__fetch'.length + 1,
      instructionChars: 300,
      schemaChars: 0,
    });
    expect(record?.servers.plugin_kit_db.tools).toBe(1);
    // Filed under the name its tools would carry, which is how every other join finds it.
    expect(record?.servers.my_server.instructionChars).toBe(50);
    // The client's own deferred tool, plus the framing around both lists: 100 and 10.
    expect(record?.toolList).toEqual({ chars: 'Monitor'.length + 1 + 100 + 10, items: 1 });
  });

  it('follows the list through the session: a server that connects late counts, one that leaves does not', async () => {
    const { evidence } = await scanLines([
      attachment({ type: 'deferred_tools_delta', addedNames: ['mcp__gone__x'], addedLines: ['mcp__gone__x'], failedMcpServers: [{ name: 'late' }, { name: 'dead' }] }, 'q'.repeat(20)),
      reply('m1', 50_000),
      attachment({ type: 'deferred_tools_delta', addedNames: ['mcp__late__x'], addedLines: ['mcp__late__x'], removedNames: ['mcp__gone__x'] }, 'q'.repeat(20)),
      reply('m2', 51_000),
    ]);
    const record = evidence.sessions[0].record;
    expect(Object.keys(record?.servers ?? {})).toEqual(['late']);
    // `late` failed its first handshake and connected on a later one, so it did send something.
    expect(record?.failedServers).toEqual(['dead']);
  });

  it("reads the client's own prompt and tools, with the schema under any of its three names", async () => {
    const tools = [
      { name: 'Bash', description: 'd'.repeat(100), schema: { type: 'object' } },
      { name: 'Read', description: 'd'.repeat(50), input_schema: { type: 'object' } },
      { name: 'mcp__acme__search', description: 'd'.repeat(10), inputSchema: { type: 'object' } },
    ];
    const size = (tool: { name: string; description: string }): number =>
      JSON.stringify({ name: tool.name, description: tool.description, input_schema: { type: 'object' } }).length;
    const { evidence } = await scanLines([
      attachment({ type: 'prompt_snapshot', systemPrompt: ['a'.repeat(1_000), 'b'.repeat(500)] }),
      reply('m1', 50_000),
      attachment({ type: 'prompt_snapshot', systemPrompt: ['a'.repeat(1_000), 'b'.repeat(500)], tools, cliPrefix: 'x' }),
    ]);
    const record = evidence.sessions[0].record;
    expect(record?.systemPrompt).toEqual({ chars: 1_500, items: 2 });
    expect(record?.builtinTools).toEqual({ chars: size(tools[0]) + size(tools[1]), items: 2 });
    // Loaded up front rather than deferred, so its schema is already in the prompt.
    expect(record?.servers.acme).toMatchObject({ tools: 1, schemaChars: size(tools[2]) });
  });

  it('🚨 counts a hook or a session block as prefix only in front of the first turn', async () => {
    const { evidence } = await scanLines([
      attachment({ type: 'hook_additional_context', content: ['x'] }, 'h'.repeat(200)),
      attachment({ type: 'date', date: '2026-09-01' }, 'd'.repeat(60)),
      // Conversation, not prefix: a file somebody dragged in is on no allowlist.
      attachment({ type: 'file', filename: '/repo/big.ts' }, 'f'.repeat(9_000)),
      reply('m1', 50_000),
      attachment({ type: 'hook_additional_context', content: ['x'] }, 'h'.repeat(200)),
      reply('m2', 51_000),
    ]);
    const record = evidence.sessions[0].record;
    expect(record?.hooks).toEqual({ chars: 200, items: 1 });
    expect(record?.sessionDetails).toEqual({ chars: 60, items: 1 });
  });

  it('keeps the first listing, not the one a compaction re-sends', async () => {
    const { evidence } = await scanLines([
      attachment({ type: 'skill_listing', content: LISTING, isInitial: true, names: LISTING_NAMES }, LISTING),
      reply('m1', 50_000),
      attachment({ type: 'skill_listing', content: '- ship', isInitial: true, names: ['ship'] }, '- ship'),
    ]);
    expect(evidence.sessions[0].record?.skillListing?.entries).toBe(4);
  });

  it('has no record for a session that attached nothing, and never throws on a shape it does not know', async () => {
    const { evidence } = await scanLines([
      attachment({ type: 'skill_listing', content: 42, names: 'nope' }),
      attachment({ type: 'instructions', files: 'nope' }),
      attachment({ type: 'deferred_tools_delta', addedNames: null }),
      JSON.stringify({ type: 'attachment', attachment: null }),
      reply('m1', 50_000),
    ]);
    expect(evidence.sessions[0].record).toBeNull();
  });

  it('marks a session a script started, so it is not the one read for what your agent is sent', async () => {
    const { evidence } = await scanLines([reply('m1', 50_000, [], { entrypoint: 'sdk-cli' })]);
    expect(evidence.sessions[0].headless).toBe(true);
  });
});

describe('two places decide what is prefix, and each is held on its own', () => {
  // The scan asks `wantsAttachment` before it pays to parse a line, and `recordAttachment` decides
  // again once it has. Through the scan each one hides the other's failure: put the bug back in
  // either and the test above stays green. So both are called directly.
  const hook = attachment({ type: 'hook_additional_context', content: ['x'] }, 'h'.repeat(200));

  it('does not parse a hook line once the first turn has been billed', () => {
    expect(wantsAttachment(newRecordAccumulator(), hook, true)).toBe(true);
    expect(wantsAttachment(newRecordAccumulator(), hook, false)).toBe(false);
  });

  it('does not count one either, if it is handed the line anyway', () => {
    const acc = newRecordAccumulator();
    recordAttachment(acc, JSON.parse(hook) as Record<string, unknown>, false);
    expect(finalizeRecord(acc)).toBeNull();
    recordAttachment(acc, JSON.parse(hook) as Record<string, unknown>, true);
    expect(finalizeRecord(acc)?.hooks).toEqual({ chars: 200, items: 1 });
  });
});

describe('🚨 one reply is one turn, however many lines it was written as', () => {
  it('bills a reply once and still reads the tool calls on every line of it', async () => {
    const { evidence } = await scanLines([
      reply('m1', 50_000, [{ type: 'thinking' }]),
      reply('m1', 50_000, [{ type: 'tool_use', name: 'mcp__acme__search', input: {} }]),
      reply('m1', 50_000, [{ type: 'tool_use', name: 'mcp__acme__fetch', input: {} }]),
      reply('m2', 60_000, [{ type: 'text' }]),
    ]);
    const [session] = evidence.sessions;
    expect(session.turns).toBe(2);
    expect(session.contextTokens).toBe(110_000);
    expect(evidence.projects[0].mcpServers.acme.calls).toBe(2);
  });
});

describe('one session, turn by turn', () => {
  it('reads the series in order, once per reply, and marks where the client compacted', async () => {
    const { path } = await scanLines([
      reply('m1', 50_000),
      reply('m1', 50_000),
      reply('m2', 90_000),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
      JSON.stringify({ type: 'user', isCompactSummary: true, message: { content: 'summary' } }),
      reply('m3', 55_000),
      reply('m4', 70_000),
    ]);
    const series = await readSessionSeries(path);
    expect(series.turns).toEqual([50_000, 90_000, 55_000, 70_000]);
    // The boundary and the summary are one event, marked at the first reply after it.
    expect(series.compactions).toEqual([2]);
    expect(summarize(series)).toEqual({ turns: 4, peak: 90_000, floor: 55_000, compactions: 1 });
  });

  it('never averages a spike away when it draws fewer columns than turns', () => {
    expect(downsample([1, 9, 2, 2, 3, 8], 3)).toEqual([9, 2, 8]);
    expect(downsample([1, 2], 10)).toEqual([1, 2]);
  });
});
