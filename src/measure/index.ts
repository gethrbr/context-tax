/**
 * What the loaded config costs.
 *
 * The config half says *what is loaded*; this says *what it weighs*. They are separate passes
 * because they fail differently: resolving reads files that are always there, measuring starts
 * servers that may not answer, and a failure in the second must never be allowed to look like a
 * finding in the first.
 *
 * Three rules govern every row:
 *
 *  1. **A server that did not answer is `unmeasured`, never `0`.** Zero would mean "free", and the
 *     ledger would recommend keeping a server you are paying for.
 *  2. **Nothing is started that is not already running in your sessions.** A server the config has
 *     turned off is never spawned to find out what it would have cost. See `trustProjectServers`
 *     for the other half of that rule.
 *  3. **Identical servers are measured once.** `acme` and `acme-dev` are two names for two
 *     different specs and both get started; two entries with the same spec share one probe, so
 *     nothing that needs interactive auth is ever asked for it twice in one run.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ResolveResult } from '../resolve/types.js';
import { MAX_AGE_MS, VERSION, cacheKey, readCache, writeCache } from './cache.js';
import { countedInstructions, probeServer, serializeTool } from './client.js';
import { fallbackFor } from './fallback.js';
import { tokens } from './tokens.js';
import type {
  MeasureResult,
  MeasuredGroup,
  MeasuredMcpServer,
  MeasuredTool,
  UnmeasuredCause,
} from './types.js';

export interface MeasureOptions {
  /** Start servers to ask them. `false` is `--no-spawn`: cache and fallback table only. */
  spawn?: boolean;
  /** Per server, not per attempt. */
  timeoutMs?: number;
  /** Ignore cached measurements and take fresh ones. */
  refresh?: boolean;
  cacheDir?: string;
  /**
   * Whether servers declared by the target directory's `.mcp.json` may be started.
   *
   * 🚨 Starting a project server runs whatever command that repo's `.mcp.json` names. When you are
   * standing in the directory, that is the same command your own session starts, so the tool adds
   * no exposure. When `--cwd` points somewhere else, it is not: pointing this at a repo you just
   * cloned would execute code from it on the strength of a flag. The CLI sets this to `false`
   * whenever `--cwd` is not the real working directory, and those rows say why they were skipped.
   */
  trustProjectServers?: boolean;
  /** Injectable so tests do not depend on the clock. */
  now?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function defaultCacheDir(home: string = homedir()): string {
  return join(home, '.cache', 'context-tax', 'schemas');
}

function group(items: number, chars: number): MeasuredGroup {
  return { items, chars, tokens: tokens(chars) };
}

/** A row that has a number. The four call sites all need the same arithmetic done the same way. */
function costed(
  name: string,
  status: MeasuredMcpServer['status'],
  transportUsed: string | null,
  /** As the server sent it. `costed` applies the client's cap; callers pass the raw length. */
  instructionsChars: number,
  tools: MeasuredTool[],
  /** Only the fallback table needs this: it knows the count without knowing the tools. */
  toolCount = tools.length,
): MeasuredMcpServer {
  // The client truncates a long instructions blob, so the raw length is not what anyone pays.
  const counted = countedInstructions(instructionsChars);
  const chars = tools.reduce((sum, tool) => sum + tool.chars, 0) + counted;
  // One unitemised tool poisons the resident half, so the whole row reports null rather than a
  // total that silently omits a server's biggest tool.
  const listing = tools.every((tool) => tool.listingChars !== null)
    ? tools.reduce((sum, tool) => sum + (tool.listingChars ?? 0), 0) + counted
    : null;
  return {
    name,
    status,
    toolCount,
    chars,
    tokens: tokens(chars),
    residentChars: listing,
    residentTokens: listing === null ? null : tokens(listing),
    instructionsChars: counted,
    instructionsDroppedChars: instructionsChars - counted,
    unsentChars: tools.reduce((sum, tool) => sum + (tool.unsent ?? 0), 0),
    transportUsed,
    tools,
  };
}

function unmeasured(name: string, reason: string, cause: UnmeasuredCause): MeasuredMcpServer {
  return {
    name,
    status: { kind: 'unmeasured', reason, cause },
    toolCount: null,
    chars: null,
    tokens: null,
    residentChars: null,
    residentTokens: null,
    instructionsChars: null,
    instructionsDroppedChars: null,
    unsentChars: null,
    transportUsed: null,
    tools: [],
  };
}

export async function measureContext(
  resolved: ResolveResult,
  options: MeasureOptions = {},
): Promise<MeasureResult> {
  const { config, launch } = resolved;
  const spawnAllowed = options.spawn ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const now = options.now ?? Date.now();
  const trustProject = options.trustProjectServers ?? true;

  const contacted: string[] = [];
  const spawned: string[] = [];
  const problems = [...config.problems];

  /** key -> in-flight probe, so two identical specs cost one launch. */
  const inFlight = new Map<string, Promise<MeasuredMcpServer>>();

  const measureOne = async (server: (typeof config.mcpServers)[number]): Promise<MeasuredMcpServer> => {
    const spec = launch.get(server.name);
    if (spec === undefined) {
      return unmeasured(server.name, 'no launch spec was resolved for it', 'declined');
    }

    const key = cacheKey(spec);

    // `--no-spawn` takes any cached entry, however old: a stale number that says where it came
    // from beats a blank row, and the row is marked `cached` either way.
    const maxAge = options.refresh === true ? -1 : spawnAllowed ? MAX_AGE_MS : Infinity;
    const hit = await readCache(cacheDir, key, maxAge, now);
    if (hit !== null) {
      return costed(
        server.name,
        { kind: 'cached', at: hit.measuredAt },
        hit.transport,
        hit.instructionsChars,
        hit.tools,
      );
    }

    const estimate = (): MeasuredMcpServer | null => {
      const row = fallbackFor(spec);
      if (row === null) return null;
      return costed(
        server.name,
        { kind: 'estimated', source: `${row.id}, measured ${row.measuredAt}` },
        null,
        row.instructionsChars,
        [
          {
            name: `${row.toolCount} tools, not itemised`,
            chars: row.schemaChars,
            listingChars: row.listingChars,
          },
        ],
        row.toolCount,
      );
    };

    const declined = (reason: string, cause: UnmeasuredCause = 'declined'): MeasuredMcpServer =>
      estimate() ?? unmeasured(server.name, reason, cause);

    if (!spawnAllowed) return declined('not started (--no-spawn), and not in the fallback table');
    if (!server.enabled) return declined('configured but off, so it was not started to find out');
    if (server.scope === 'project-mcp-json' && !trustProject) {
      return declined('declared by a .mcp.json outside the working directory, so it was not run');
    }

    const shared = inFlight.get(key);
    if (shared !== undefined) return { ...(await shared), name: server.name };

    const probe = (async (): Promise<MeasuredMcpServer> => {
      if (spec.transport === 'stdio') spawned.push(spec.command ?? server.name);
      else if (spec.url !== null) contacted.push(new URL(spec.url).host);

      try {
        const result = await probeServer(spec, timeoutMs);
        const tools = result.tools.map((tool) => ({
          name: tool.name,
          chars: serializeTool(tool),
          // What the client leaves in the listing when it defers the schema, measured 2026-09-02.
          listingChars: tool.name.length + (tool.description ?? '').length,
          unsent: Math.max(0, tool.rawChars - serializeTool(tool)),
        }));
        const measuredAt = new Date(now).toISOString();
        await writeCache(cacheDir, key, {
          version: VERSION,
          measuredAt,
          transport: result.transport,
          instructionsChars: result.instructions.length,
          tools,
        });
        return costed(
          server.name,
          { kind: 'measured', at: measuredAt },
          result.transport,
          result.instructions.length,
          tools,
        );
      } catch (error) {
        // The server's own words, not ours. "HTTP 400" is not a finding; the body behind it is.
        // `failed` rather than `declined`: we asked and it could not answer, which means your
        // sessions get nothing from it either. That is a verdict, not a gap in our data.
        return declined(error instanceof Error ? error.message : String(error), 'failed');
      }
    })();

    inFlight.set(key, probe);
    return probe;
  };

  // In parallel, because a session starts them all at once too and a serial pass would turn six
  // ten-second timeouts into a minute of staring at nothing.
  const servers = await Promise.all(config.mcpServers.map(measureOne));

  /** A shadowed entry is not listed to the model, so it costs nothing and is not counted. */
  const listed = <T extends { shadowedBy: unknown; listingChars: number }>(items: T[]): MeasuredGroup => {
    const visible = items.filter((item) => item.shadowedBy === null);
    return group(visible.length, visible.reduce((sum, item) => sum + item.listingChars, 0));
  };

  const alwaysLoaded = config.memory.filter((file) => file.alwaysLoaded);
  const skills = listed(config.skills);
  const agents = listed(config.agents);
  const memory = group(alwaysLoaded.length, alwaysLoaded.reduce((sum, file) => sum + file.bytes, 0));

  return {
    contacted: [...new Set(contacted)],
    spawned: [...new Set(spawned)],
    servers,
    skills,
    agents,
    memory,
    // 🔑 `?? 0` here is not the forbidden confident zero: a row with `null` tokens is counted in
    // `unmeasured` on the next line, so the reader is told the total is short and by how many rows.
    measuredTokens:
      servers.reduce((sum, server) => sum + (server.tokens ?? 0), 0) +
      skills.tokens +
      agents.tokens +
      memory.tokens,
    // Skills, agents and memory are listing-only already: their frontmatter is resident and their
    // bodies are not counted anywhere, so they carry the same number into both totals.
    residentTokens:
      servers.reduce((sum, server) => sum + (server.residentTokens ?? 0), 0) +
      skills.tokens +
      agents.tokens +
      memory.tokens,
    unsplit: servers.filter(
      (server) => server.tokens !== null && server.residentTokens === null,
    ).length,
    unmeasured: servers.filter((server) => server.status.kind === 'unmeasured').length,
    problems,
  };
}

export { CALIBRATION, CHARS_PER_TOKEN, PROVISIONAL_NOTE, tokens } from './tokens.js';
export { cacheKey } from './cache.js';
export { probeServer, serializeTool, unsentChars, redact, SseParser, McpError } from './client.js';
export { FALLBACK_TABLE, fallbackFor, packageOf } from './fallback.js';
export type { MeasureResult, MeasureStatus, MeasuredGroup, MeasuredMcpServer, MeasuredTool } from './types.js';
export type { ProbeResult, RawTool } from './client.js';
