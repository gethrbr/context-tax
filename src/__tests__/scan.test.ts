/**
 * What the evidence pass is allowed to claim.
 *
 * The scan's whole value is that its numbers are measured rather than inferred, so the properties
 * worth pinning are the ones where a plausible-looking implementation would quietly report a wrong
 * number instead of failing:
 *
 * 1. A corrupt line is **counted, not thrown**. Transcripts are appended to by a live process and
 *    can be truncated mid-write; one bad line aborting a scan over 900 files would make the tool
 *    unusable exactly when a session is running.
 * 2. Cold start is only a cold start when **nothing came from cache**. Taking the first turn
 *    unconditionally would report a cache hit as the prompt size and understate the prefix.
 * 3. Model-invoked and user-typed skills are **different numbers**, because they map to different
 *    `skillOverrides` states and conflating them would recommend deleting a skill that is used.
 * 4. A session with no recorded `cwd` **joins no project**, rather than joining the wrong one.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractSlashCommands, parseMcpToolName, scanEvidence } from '../evidence/index.js';

interface UsageOverrides {
  input?: number;
  cacheCreation?: number;
  cacheRead?: number;
  output?: number;
}

function assistant(
  content: unknown[],
  usage: UsageOverrides = {},
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    cwd: '/repo',
    timestamp: '2026-09-01T10:00:00.000Z',
    ...extra,
    message: {
      content,
      usage: {
        input_tokens: usage.input ?? 0,
        cache_creation_input_tokens: usage.cacheCreation ?? 0,
        cache_read_input_tokens: usage.cacheRead ?? 0,
        output_tokens: usage.output ?? 0,
      },
    },
  });
}

function userCommand(name: string): string {
  return JSON.stringify({
    type: 'user',
    sessionId: 's1',
    cwd: '/repo',
    timestamp: '2026-09-01T10:00:01.000Z',
    message: { content: `<command-name>/${name}</command-name>` },
  });
}

function toolUse(name: string, input: Record<string, unknown> = {}): unknown {
  return { type: 'tool_use', name, input };
}

/** Writes one `projects/<slug>/<session>.jsonl` tree and scans it. */
async function scanFixture(files: Record<string, string[]>) {
  const root = await mkdtemp(join(tmpdir(), 'context-tax-'));
  for (const [name, lines] of Object.entries(files)) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, 'session.jsonl'), `${lines.join('\n')}\n`);
  }
  return scanEvidence({ projectsDir: root });
}

describe('parseMcpToolName', () => {
  it('splits a server from its tool', () => {
    expect(parseMcpToolName('mcp__acme__acme_get_knowledge')).toEqual({
      server: 'acme',
      tool: 'acme_get_knowledge',
    });
  });

  it('keeps underscores inside a tool name, which real tools have', () => {
    expect(parseMcpToolName('mcp__claude-in-chrome__tabs_context_mcp')?.tool).toBe(
      'tabs_context_mcp',
    );
  });

  it('declines anything that is not a fully formed mcp name', () => {
    expect(parseMcpToolName('Bash')).toBeNull();
    expect(parseMcpToolName('mcp__onlyserver')).toBeNull();
    expect(parseMcpToolName('mcp____tool')).toBeNull();
  });
});

describe('extractSlashCommands', () => {
  it('reads a command out of plain string content', () => {
    expect(extractSlashCommands('<command-name>/compact</command-name>')).toEqual(['compact']);
  });

  it('reads one out of content blocks, and keeps a plugin-qualified name whole', () => {
    expect(
      extractSlashCommands([{ type: 'text', text: '<command-name>/pr-review:review</command-name>' }]),
    ).toEqual(['pr-review:review']);
  });

  it('returns nothing for content that has none', () => {
    expect(extractSlashCommands('just a message')).toEqual([]);
    expect(extractSlashCommands(undefined)).toEqual([]);
  });
});

describe('scanEvidence', () => {
  it('counts a malformed line instead of throwing, and keeps the rest of the file', async () => {
    const evidence = await scanFixture({
      a: [
        assistant([], { cacheCreation: 100 }),
        '{"type":"assistant","message":{ TRUNCATED',
        assistant([toolUse('Bash')], { cacheRead: 100 }),
      ],
    });

    expect(evidence.malformedLines).toBe(1);
    expect(evidence.projects[0].turns).toBe(2);
    expect(evidence.projects[0].builtinTools.Bash).toBe(1);
  });

  it('takes cold start from the first turn that read NOTHING from cache', async () => {
    const evidence = await scanFixture({
      // A resumed session: its first turn is a cache hit, so it is not a cold start.
      a: [assistant([], { cacheRead: 40_000 }), assistant([], { cacheCreation: 12_345 })],
    });

    expect(evidence.projects[0].coldStart?.median).toBe(12_345);
  });

  it('reports no cold start at all when every turn was a cache hit, rather than guessing one', async () => {
    const evidence = await scanFixture({ a: [assistant([], { cacheRead: 40_000 })] });

    expect(evidence.projects[0].coldStart).toBeNull();
    expect(evidence.projects[0].turns).toBe(1);
  });

  it('sums context exactly as the API billed it', async () => {
    const evidence = await scanFixture({
      a: [assistant([], { input: 2, cacheCreation: 1_000, cacheRead: 500, output: 90 })],
    });

    expect(evidence.projects[0].contextTokens).toBe(1_502);
    expect(evidence.projects[0].outputTokens).toBe(90);
  });

  it('separates a skill the MODEL chose from one a human typed', async () => {
    const evidence = await scanFixture({
      a: [
        assistant([toolUse('Skill', { skill: 'apple-design' })], { cacheCreation: 10 }),
        userCommand('apple-design'),
        userCommand('compact'),
      ],
    });

    const project = evidence.projects[0];
    expect(project.skills['apple-design']).toEqual({ model: 1, user: 0 });
    // Typed commands stay unfiltered here — built-ins and skills alike. The join against the
    // resolved skill set decides which are skills, so no stale built-in list can misattribute one.
    expect(project.slashCommands).toEqual({ 'apple-design': 1, compact: 1 });
  });

  it('buckets mcp calls by server and keeps the per-tool split', async () => {
    const evidence = await scanFixture({
      a: [
        assistant(
          [
            toolUse('mcp__acme__acme_get_knowledge'),
            toolUse('mcp__acme__acme_search_knowledge'),
            toolUse('mcp__analytics__exec'),
          ],
          { cacheCreation: 10 },
        ),
      ],
    });

    const { mcpServers } = evidence.projects[0];
    expect(mcpServers.acme.calls).toBe(2);
    expect(mcpServers.acme.sessions).toBe(1);
    expect(mcpServers.acme.tools).toEqual({ acme_get_knowledge: 1, acme_search_knowledge: 1 });
    expect(mcpServers.analytics.calls).toBe(1);
  });

  it('counts a server once per session however many calls it made', async () => {
    const lines = [
      assistant([toolUse('mcp__acme__acme_get_knowledge')], { cacheCreation: 10 }),
      assistant([toolUse('mcp__acme__acme_get_knowledge')], { cacheRead: 10 }),
    ];
    const evidence = await scanFixture({ a: lines, b: lines });

    expect(evidence.projects[0].mcpServers.acme).toMatchObject({ calls: 4, sessions: 2 });
  });

  it('counts subagent turns separately so they cannot skew the prefix median', async () => {
    const evidence = await scanFixture({
      a: [
        assistant([], { cacheCreation: 100 }),
        assistant([], { cacheRead: 100 }, { isSidechain: true }),
      ],
    });

    expect(evidence.projects[0].turns).toBe(2);
    expect(evidence.projects[0].sidechainTurns).toBe(1);
  });

  it('records an agent by its subagent type', async () => {
    const evidence = await scanFixture({
      a: [assistant([toolUse('Agent', { subagent_type: 'Explore' })], { cacheCreation: 10 })],
    });

    expect(evidence.projects[0].agents).toEqual({ Explore: 1 });
  });

  it('joins a session with no recorded cwd to NO project rather than to the wrong one', async () => {
    const noCwd = JSON.stringify({
      type: 'assistant',
      sessionId: 'orphan',
      timestamp: '2026-09-01T10:00:00.000Z',
      message: { content: [], usage: { cache_creation_input_tokens: 999 } },
    });
    const evidence = await scanFixture({ a: [noCwd] });

    expect(evidence.sessions).toHaveLength(1);
    expect(evidence.projects).toHaveLength(0);
  });

  /**
   * 🚨 The bug this pins cost a confident wrong number, not a crash. Subagent transcripts live at
   * `<slug>/<session-id>/subagents/*.jsonl`; a top-level-only scan missed 87 files of billed work
   * on a real machine and reported `0 subagent turns` — an absence dressed as a measurement.
   */
  it('finds subagent transcripts one level down, and bills them without counting them as sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'context-tax-'));
    await mkdir(join(root, 'slug', 'session-1', 'subagents'), { recursive: true });
    await writeFile(
      join(root, 'slug', 'session.jsonl'),
      `${assistant([], { cacheCreation: 50_000 })}\n`,
    );
    await writeFile(
      join(root, 'slug', 'session-1', 'subagents', 'agent.jsonl'),
      `${assistant([toolUse('mcp__acme__acme_get_knowledge')], { cacheCreation: 9_000 })}\n`,
    );

    const project = (await scanEvidence({ projectsDir: root })).projects[0];

    expect(project.turns).toBe(2);
    expect(project.sidechainTurns).toBe(1);
    // Billed, so it counts toward context; and a subagent's MCP call is real usage.
    expect(project.contextTokens).toBe(59_000);
    expect(project.mcpServers.acme.calls).toBe(1);
    // But it is not a session a human started, and its prefix is a different one.
    expect(project.sessions).toBe(1);
    expect(project.coldStart).toEqual({ count: 1, median: 50_000, min: 50_000, max: 50_000 });
  });

  it('returns an empty result for a projects directory that is not there', async () => {
    const evidence = await scanEvidence({ projectsDir: join(tmpdir(), 'context-tax-absent-xyz') });

    expect(evidence).toMatchObject({ scannedFiles: 0, malformedLines: 0, projects: [] });
  });
});
