/**
 * Measurement, against a real MCP server rather than a mock of one.
 *
 * The client's failure mode is not a crash, it is a server answering in a shape we did not expect
 * and a row quietly coming back empty. A mocked transport would only prove the mock agrees with
 * itself, so the stdio tests run `fixtures/stdio-server.mjs` as a child process and the HTTP tests
 * stand up a real listener.
 *
 * Tests marked 🚨 exist because the first implementation got them wrong against real servers on
 * this machine, and got them wrong silently.
 */

import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_AGE_MS, cacheKey, readCache, writeCache } from '../measure/cache.js';
import {
  INSTRUCTIONS_CAP,
  McpError,
  SseParser,
  countedInstructions,
  probeServer,
  redact,
  serializeTool,
  unsentChars,
} from '../measure/client.js';
import { FALLBACK_TABLE, fallbackFor, packageOf } from '../measure/fallback.js';
import { measureContext } from '../measure/index.js';
import { CALIBRATION, CHARS_PER_TOKEN, tokens } from '../measure/tokens.js';
import type { McpLaunchSpec, ResolveResult, ResolvedConfig, ResolvedMcpServer } from '../resolve/types.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/stdio-server.mjs', import.meta.url));

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'context-tax-measure-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

function stdioSpec(mode: string, overrides: Partial<McpLaunchSpec> = {}): McpLaunchSpec {
  return {
    name: 'fixture',
    transport: 'stdio',
    command: process.execPath,
    args: [FIXTURE, mode],
    env: {},
    url: null,
    headers: {},
    ...overrides,
  };
}

function serverRow(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    name: 'fixture',
    transport: 'stdio',
    command: process.execPath,
    argCount: 2,
    entry: FIXTURE,
    envKeys: [],
    url: null,
    headerKeys: [],
    scope: 'user',
    path: '/nowhere/.claude.json',
    plugin: null,
    enabled: true,
    enabledReason: 'on',
    fixLever: { kind: 'none', why: 'test' },
    configuredSince: { known: false, reason: 'test' },
    ...overrides,
  };
}

function resolved(servers: ResolvedMcpServer[], launch: Map<string, McpLaunchSpec>): ResolveResult {
  const config: ResolvedConfig = {
    cwd: '/nowhere',
    repoRoot: null,
    settingsTarget: '/nowhere/.claude/settings.local.json',
    sources: [],
    mcpServers: servers,
    skills: [],
    agents: [],
    commands: [],
    memory: [],
    plugins: [],
    problems: [],
  };
  return { config, launch };
}

/* ---------------------------------------------------------------------------------------- */

describe('the tokenizer', () => {
  it('holds the pre-registered prediction, so changing the ratio cannot pass unrecorded', () => {
    // 🔑 Written down before the measurement, not fitted to it. Moving CHARS_PER_TOKEN breaks this
    // test on purpose, so the ratio cannot be tuned until the output looks plausible.
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(tokens(CALIBRATION.prediction.chars)).toBe(CALIBRATION.prediction.tokens);
  });

  it('🚨 kept the ratio after measuring it, rather than fitting it to the result', () => {
    // 2026-09-02: acme's resident context measured 912 tokens against 948 predicted by chars/4.
    // A 4% miss is not a reason to move a pre-registered constant, and this pins that decision so
    // the next person sees the measurement instead of re-deriving it.
    expect(CALIBRATION.status).toBe('measured-against-a-deferring-client');
    expect(tokens(CALIBRATION.resident.chars)).toBe(CALIBRATION.resident.predictedByRatio);
    const error = Math.abs(CALIBRATION.resident.predictedByRatio - CALIBRATION.resident.tokens);
    expect(error / CALIBRATION.resident.tokens).toBeLessThan(0.05);
  });
});

describe('tool serialization', () => {
  it('counts the three fields the API accepts and nothing else', () => {
    const chars = serializeTool({
      name: 'alpha',
      description: 'desc',
      inputSchema: { type: 'object' },
      rawChars: 999,
    });
    expect(chars).toBe(JSON.stringify({ name: 'alpha', description: 'desc', inputSchema: { type: 'object' } }).length);
  });

  it('carries what the server sent but the API cannot take, rather than resolving it silently', () => {
    // A 16% difference on `@playwright/mcp`. It is kept visible so calibration can settle it.
    const tool = { name: 'a', description: 'b', inputSchema: {}, rawChars: 0 };
    const raw = JSON.stringify({ ...tool, annotations: { title: 'A', readOnlyHint: true } }).length;
    expect(unsentChars([{ ...tool, rawChars: raw }])).toBe(raw - serializeTool(tool));
  });
});

describe('the stdio client', () => {
  it('completes the handshake and reads the tools', async () => {
    const result = await probeServer(stdioSpec('ok'), 15_000);
    expect(result.tools.map((tool) => tool.name)).toEqual(['alpha', 'beta']);
    expect(result.transport).toBe('stdio');
  });

  it('🚨 counts the instructions blob, which is context the tools/list recipe misses', async () => {
    // acme ships 4,374 characters of it against 12,183 of schemas. Counting only `tools/list`
    // under-reported the biggest row in the ledger by 26%, and did it without saying so.
    const result = await probeServer(stdioSpec('ok'), 15_000);
    expect(result.instructions).toBe('Server instructions that land in the system prompt.');
    expect(result.instructions.length).toBeGreaterThan(0);
  });

  it('follows nextCursor, so a paginated server is not measured at one page', async () => {
    const result = await probeServer(stdioSpec('paged'), 15_000);
    expect(result.tools.map((tool) => tool.name)).toEqual(['alpha', 'beta']);
  });

  it('ignores non-JSON chatter on stdout, which real servers emit despite the spec', async () => {
    const result = await probeServer(stdioSpec('noisy'), 15_000);
    expect(result.tools).toHaveLength(2);
  });

  it("reports the server's own stderr, because 'exited with code 1' is not a diagnosis", async () => {
    await expect(probeServer(stdioSpec('crash'), 15_000)).rejects.toThrow(/error 404 not found/);
  });

  it('gives up at the timeout instead of waiting on a server that never answers', async () => {
    const started = Date.now();
    await expect(probeServer(stdioSpec('hang'), 700)).rejects.toThrow(McpError);
    expect(Date.now() - started).toBeLessThan(6_000);
  });
});

describe('the HTTP client', () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    server = createServer((request, response) => {
      // Exactly what mcp.context7.com does to a legacy SSE GET.
      if (request.method === 'GET') {
        response.writeHead(405).end('Method Not Allowed');
        return;
      }
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      request.on('end', () => {
        const message = JSON.parse(body) as { id?: number; method?: string };
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        const result =
          message.method === 'initialize'
            ? { protocolVersion: '2025-06-18', capabilities: {}, instructions: 'remote instructions' }
            : { tools: [{ name: 'remote', description: 'd', inputSchema: {} }] };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}/mcp`;
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const remote = (transport: 'http' | 'sse'): McpLaunchSpec => ({
    name: 'remote',
    transport,
    command: null,
    args: [],
    env: {},
    url,
    headers: {},
  });

  it('speaks streamable HTTP and reads the instructions', async () => {
    const result = await probeServer(remote('http'), 15_000);
    expect(result.tools.map((tool) => tool.name)).toEqual(['remote']);
    expect(result.instructions).toBe('remote instructions');
  });

  it('🚨 falls back when the declared transport is wrong, which is the case that matters most', async () => {
    // `acme/.mcp.json` declares context7 as `"type": "sse"` against the streamable HTTP endpoint,
    // which answers a legacy SSE GET with 405. Without the retry the row reads `unmeasured`, so a
    // failure of ours sits where a finding about the user's config belongs and nothing on screen
    // tells them apart.
    const result = await probeServer(remote('sse'), 15_000);
    expect(result.tools.map((tool) => tool.name)).toEqual(['remote']);
    expect(result.transport).toBe('http');
  });
});

describe('SSE framing', () => {
  it('reassembles events split across chunks and joins multi-line data', () => {
    const parser = new SseParser();
    expect(parser.push('event: endpoint\ndata: /mes')).toEqual([]);
    expect(parser.push('sages?id=1\n\n')).toEqual([{ event: 'endpoint', data: '/messages?id=1' }]);
    expect(parser.push('data: a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});

describe('the cache', () => {
  // ⚠️ Low entropy on purpose, and it must stay that way. The realistic-looking placeholder this
  // started as tripped the repo's `generic-api-key` gitleaks rule and blocked the commit. The bytes
  // are arbitrary here: the assertions only ask whether this exact string survives into the cache
  // file, so nothing is gained by making it look like a key and a real gate is lost.
  const secret = 'placeholder-value-that-must-never-be-written';
  const withSecrets = (): McpLaunchSpec =>
    stdioSpec('ok', {
      args: [FIXTURE, 'ok', `--api-key=${secret}`],
      env: { SERVICE_API_KEY: secret },
      headers: { Authorization: `Bearer ${secret}` },
    });

  it('🔒 keys on environment variable names, not values, so a rotated token is not a cache miss', () => {
    const before = cacheKey(withSecrets());
    const after = cacheKey({ ...withSecrets(), env: { SERVICE_API_KEY: 'a-completely-different-value' } });
    expect(after).toBe(before);
  });

  it('keys on arguments, because two versions of a package are two different servers', () => {
    const one = cacheKey(stdioSpec('ok', { args: ['pkg@1'] }));
    const two = cacheKey(stdioSpec('ok', { args: ['pkg@2'] }));
    expect(one).not.toBe(two);
  });

  it('🔒 writes nothing that could identify the machine it came from', async () => {
    const key = cacheKey(withSecrets());
    await writeCache(cacheDir, key, {
      version: 2,
      measuredAt: '2026-09-01T00:00:00.000Z',
      transport: 'stdio',
      instructionsChars: 10,
      tools: [{ name: 'alpha', chars: 100, listingChars: 40 }],
    });
    const files = await readdir(cacheDir);
    const body = await readFile(join(cacheDir, files[0]), 'utf8');
    expect(body).not.toContain(secret);
    expect(body).not.toContain('SERVICE_API_KEY');
    expect(body).not.toContain(process.execPath);
    expect(body).not.toContain('fixture');
  });

  it('expires entries, and accepts any age when nothing may be started to refresh them', async () => {
    const key = 'abc';
    const stale = { version: 2, measuredAt: '2020-01-01T00:00:00.000Z', transport: 'stdio', instructionsChars: 0, tools: [] };
    await writeCache(cacheDir, key, stale);
    const now = Date.parse('2026-09-01T00:00:00.000Z');
    expect(await readCache(cacheDir, key, MAX_AGE_MS, now)).toBeNull();
    expect(await readCache(cacheDir, key, Infinity, now)).not.toBeNull();
  });

  it('treats a corrupt entry as a miss rather than an error', async () => {
    await writeFile(join(cacheDir, 'broken.json'), '{not json', 'utf8');
    expect(await readCache(cacheDir, 'broken', MAX_AGE_MS, Date.now())).toBeNull();
  });
});

describe('the fallback table', () => {
  it('matches a package regardless of the version pinned after it', () => {
    expect(packageOf('@playwright/mcp@latest')).toBe('@playwright/mcp');
    expect(packageOf('chrome-devtools-mcp@0.6.0')).toBe('chrome-devtools-mcp');
    expect(packageOf('@scope/pkg')).toBe('@scope/pkg');
  });

  it('finds a stdio server by package and a remote one by host', () => {
    expect(fallbackFor(stdioSpec('ok', { args: ['-y', '@playwright/mcp@latest'] }))?.toolCount).toBe(24);
    expect(
      fallbackFor({
        name: 'c',
        transport: 'sse',
        command: null,
        args: [],
        env: {},
        url: 'https://mcp.context7.com/mcp',
        headers: {},
      })?.toolCount,
    ).toBe(2);
  });

  it('carries only public servers, since this table ships to everyone', () => {
    for (const row of FALLBACK_TABLE) expect(row.id).not.toMatch(/localhost|127\.0\.0\.1|\.internal\b|\.local\b/);
  });
});

describe('redaction', () => {
  it('scrubs what we handed the server out of what it handed back', () => {
    expect(redact('failed with token placeholder-value-here', ['placeholder-value-here'])).toBe(
      'failed with token [redacted]',
    );
  });

  it('leaves short values alone, which would shred the message without protecting anything', () => {
    expect(redact('exit code 1', ['1'])).toBe('exit code 1');
  });
});

describe('what a probe leaves behind', () => {
  it.skipIf(process.platform === 'win32')(
    '🚨 kills the server it started, not just the wrapper that started it',
    async () => {
      // `npx pkg` and `bash -c "node server.js"` both fork the real server, so a SIGKILL aimed at
      // the child hits a wrapper and leaves an MCP server running on the machine. It also holds
      // this process's pipes open, which is how the CLI came to print a full ledger and then never
      // exit. No `exec` in the command below, deliberately: that is the shape that forks.
      const pidPath = join(cacheDir, 'server.pid');
      const wrapped: McpLaunchSpec = {
        name: 'fixture',
        transport: 'stdio',
        command: 'bash',
        // The trailing `; true` matters: `bash -c "one command"` execs it in place and leaves no
        // grandchild to orphan, which is the thing this test exists to catch. A second command
        // forces the fork, exactly as `cd … && exec npx …` does in a real `.mcp.json`.
        args: ['-c', `${process.execPath} ${FIXTURE} sticky ${pidPath}; true`],
        env: {},
        url: null,
        headers: {},
      };

      const result = await probeServer(wrapped, 10_000);
      expect(result.tools).toHaveLength(2);

      const pid = Number(await readFile(pidPath, 'utf8'));
      expect(Number.isInteger(pid)).toBe(true);
      let alive = true;
      for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    },
  );
});

describe('measureContext', () => {
  it('counts tools and instructions together, and writes the result to the cache', async () => {
    const launch = new Map([['fixture', stdioSpec('ok')]]);
    const result = await measureContext(resolved([serverRow()], launch), { cacheDir });
    const [row] = result.servers;
    expect(row.status.kind).toBe('measured');
    expect(row.toolCount).toBe(2);
    expect(row.instructionsChars).toBe('Server instructions that land in the system prompt.'.length);
    expect(row.chars).toBe(row.tools.reduce((sum, tool) => sum + tool.chars, 0) + (row.instructionsChars ?? 0));
    expect(await readdir(cacheDir)).toHaveLength(1);
  });

  it('🚨 reads back what it wrote, so the second run starts nothing', async () => {
    // The write path stamped a hardcoded version while the read path required the current one, so
    // every entry was written unreadable. Nothing failed loudly: the cache simply never hit, and a
    // tool whose pitch is `npx context-tax` went back to a cold start every single run. Asserting
    // that a file appears is not enough, which is exactly how this survived a suite that had one.
    const launch = new Map([['fixture', stdioSpec('ok')]]);
    const first = await measureContext(resolved([serverRow()], launch), { cacheDir });
    const second = await measureContext(resolved([serverRow()], launch), { cacheDir });
    expect(first.spawned).toHaveLength(1);
    expect(second.spawned).toEqual([]);
    expect(second.servers[0].status).toMatchObject({ kind: 'cached' });
    expect(second.servers[0].chars).toBe(first.servers[0].chars);
    expect(second.servers[0].residentChars).toBe(first.servers[0].residentChars);
  });

  it('🚨 counts the instructions the model is shown, not the blob the server sent', async () => {
    // Claude Code cuts a server's instructions at INSTRUCTIONS_CAP characters and prints
    // `… [truncated]`. Counting the whole blob charges a server for prose nobody reads, and it
    // does it in the direction that flatters this tool's own headline.
    const sent = `${'Server instructions that land in the system prompt.'} `.repeat(60).length;
    const launch = new Map([['fixture', stdioSpec('verbose')]]);
    const result = await measureContext(resolved([serverRow()], launch), { cacheDir });
    const [row] = result.servers;
    expect(sent).toBeGreaterThan(INSTRUCTIONS_CAP);
    expect(row.instructionsChars).toBe(INSTRUCTIONS_CAP);
    expect(row.instructionsDroppedChars).toBe(sent - INSTRUCTIONS_CAP);
    expect(row.chars).toBe(row.tools.reduce((sum, tool) => sum + tool.chars, 0) + INSTRUCTIONS_CAP);
  });

  it('leaves an instructions blob under the cap alone', () => {
    expect(countedInstructions(10)).toBe(10);
    expect(countedInstructions(INSTRUCTIONS_CAP + 1)).toBe(INSTRUCTIONS_CAP);
  });

  it('🚨 reports a server that would not start as unmeasured, never as zero', async () => {
    // Reporting 0 would mean "free", and the ledger would then recommend keeping a server you pay
    // for. Tavily returned an empty body on initialize during research and would have scored 0.
    const launch = new Map([['fixture', stdioSpec('crash')]]);
    const result = await measureContext(resolved([serverRow()], launch), { cacheDir });
    const [row] = result.servers;
    expect(row.status).toMatchObject({ kind: 'unmeasured' });
    expect(row.chars).toBeNull();
    expect(row.tokens).toBeNull();
    expect(result.measuredTokens).toBe(0);
    expect(result.unmeasured).toBe(1);
  });

  it('never starts a server the config has turned off', async () => {
    const launch = new Map([['fixture', stdioSpec('ok')]]);
    const result = await measureContext(resolved([serverRow({ enabled: false })], launch), { cacheDir });
    expect(result.servers[0].status).toMatchObject({ kind: 'unmeasured' });
    expect(result.spawned).toEqual([]);
  });

  it('never starts a project server when the flag points at a directory we are not standing in', async () => {
    const launch = new Map([['fixture', stdioSpec('ok')]]);
    const result = await measureContext(
      resolved([serverRow({ scope: 'project-mcp-json' })], launch),
      { cacheDir, trustProjectServers: false },
    );
    expect(result.spawned).toEqual([]);
    expect(result.servers[0].status).toMatchObject({ kind: 'unmeasured' });
  });

  it('🚨 keeps the fallback table\'s own tool count instead of the shape it is stored in', async () => {
    // The estimate is one synthetic row holding a whole server's characters. Deriving the tool
    // count from `tools.length` reported `@playwright/mcp` as having one tool.
    const spec = stdioSpec('ok', { args: ['-y', '@playwright/mcp@latest'] });
    const launch = new Map([['fixture', spec]]);
    const result = await measureContext(resolved([serverRow()], launch), { cacheDir, spawn: false });
    expect(result.servers[0].status).toMatchObject({ kind: 'estimated' });
    expect(result.servers[0].toolCount).toBe(24);
  });

  /**
   * 🚨 A server that refused to start came back priced.
   *
   * The failure path reached for the fallback table before giving up, so a server whose package is
   * one of the five in that table was reported at 1,078 tokens a turn — a real measurement of
   * somebody else's working copy — while the `cannot start` finding and the spawn error behind it
   * were both dropped. Whether a broken server was reported at all depended on whether its package
   * happened to be in the table.
   *
   * The table answers *what would this have cost*. That is the wrong question about a server that
   * just told us it cannot run.
   */
  it('🚨 does not price a server that failed to start from the bundled table', async () => {
    // Args that match a table row, and a command that cannot be spawned. Both halves are needed:
    // the table is matched on the package argument, never on the command.
    const spec = stdioSpec('ok', {
      command: 'definitely-not-a-binary-xyz',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    });
    const result = await measureContext(resolved([serverRow()], new Map([['fixture', spec]])), { cacheDir });

    expect(result.servers[0].status).toMatchObject({ kind: 'unmeasured', cause: 'failed' });
    expect(result.servers[0].tokens).toBeNull();
  });

  it('still falls back to the table when nothing was started at all', async () => {
    // The other half of the same rule: `--no-spawn` never asked, so an estimate is the honest
    // answer there and the row says where it came from.
    const spec = stdioSpec('ok', { args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] });
    const result = await measureContext(resolved([serverRow()], new Map([['fixture', spec]])), {
      cacheDir,
      spawn: false,
    });

    expect(result.servers[0].status).toMatchObject({ kind: 'estimated' });
  });

  it('starts two identically configured servers once, not twice', async () => {
    const spec = stdioSpec('crash');
    const launch = new Map([
      ['one', spec],
      ['two', spec],
    ]);
    const result = await measureContext(
      resolved([serverRow({ name: 'one' }), serverRow({ name: 'two' })], launch),
      { cacheDir },
    );
    // Anything needing interactive auth must not be asked for it twice in one run.
    expect(result.spawned).toHaveLength(1);
    expect(result.servers.map((row) => row.name)).toEqual(['one', 'two']);
  });

  it('names every host it contacted, so the no-telemetry claim can be checked', async () => {
    const launch = new Map([['fixture', stdioSpec('ok')]]);
    const result = await measureContext(resolved([serverRow()], launch), { cacheDir });
    expect(result.spawned).toEqual([process.execPath]);
    expect(result.contacted).toEqual([]);
  });
});
