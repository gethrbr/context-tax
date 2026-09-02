/**
 * A minimal MCP client that asks one question: `tools/list`.
 *
 * It speaks all three transports because this machine runs all three — `analytics` over stdio,
 * `acme` over streamable HTTP, `context7` over legacy SSE — and a measurer that could only see
 * one of them would silently under-report two thirds of the servers it found.
 *
 * 🔒 Three rules hold this file to the promise on the README:
 *
 *  1. **`tools/list` and nothing else.** No `resources/*`, no `prompts/*`, and never `tools/call`.
 *     The handshake is exactly what your agent already performs at the start of every session.
 *  2. **Nothing goes anywhere new.** The only hosts contacted are the ones in your own config,
 *     with your own credentials. There is no context-tax server to send anything to. The hosts are
 *     still named in the output, because a promise you cannot check is not a promise.
 *  3. **Server output is redacted against what we injected.** A failing server can echo its own
 *     configuration back on stderr, key included. Every value we passed in is scrubbed out of the
 *     diagnostic before it is stored or printed — we know the exact strings, so this is precise
 *     rather than a hopeful regex.
 */

import { spawn } from 'node:child_process';

import type { McpLaunchSpec, McpTransport } from '../resolve/types.js';

/** The revision that introduced the `MCP-Protocol-Version` header. Servers negotiate down. */
const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'context-tax', version: '0.1.0' };

/** A page of tools is ~50; twenty pages is a runaway server, not a big one. */
const MAX_PAGES = 20;

export interface RawTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  /**
   * Serialized size of the tool object **as the server sent it**, including fields the Anthropic
   * API has no slot for. See `serializeTool` for why the two numbers are kept apart.
   */
  rawChars: number;
}

/**
 * Everything a server puts in the prefix, which is **not** just its tools.
 *
 * 🔴 `instructions` is returned by `initialize` and Claude Code injects it into the system prompt
 * verbatim, under a "MCP Server Instructions" heading. It was missing from the plan's measurement
 * recipe and it is not small: acme ships 4,374 characters of it, 36% on top of its 12,183
 * characters of schemas. A measurer that counted only `tools/list` would have under-reported the
 * largest line item in the ledger by more than a third, and would have done it silently.
 *
 * `transport` is what actually answered, which is not always what the config declared — see
 * `probeServer`.
 */
export interface ProbeResult {
  tools: RawTool[];
  instructions: string;
  transport: McpTransport;
}

export class McpError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Serialized size of one tool as the model sees it.
 *
 * The three fields that reach the model are the name, the description and the input schema. This
 * is the definition every char count in the tool depends on, so it is one function and not an
 * inline `JSON.stringify` at three call sites.
 */
export function serializeTool(tool: RawTool): number {
  return JSON.stringify({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
  }).length;
}

/**
 * What the server sent that the model cannot have been shown.
 *
 * ⚠️ **A documented assumption, not a fact, and it is worth 16%.** A tool definition on the
 * Anthropic API is `{name, description, input_schema}` and nothing else, so `annotations` — the
 * `readOnlyHint` / `destructiveHint` block a client uses to decide what to auto-approve — has
 * nowhere to go in the request and is counted as client-side metadata rather than context.
 *
 * The gap is not small. `@playwright/mcp` serializes to 18,477 characters whole and 15,896 as the
 * three fields the API takes. Counting the wrong one is a 16% error on one of the biggest rows,
 * so the difference is carried here instead of being quietly resolved in one direction, and
 * `/context` calibration is what settles it.
 */
export function unsentChars(tools: RawTool[]): number {
  return tools.reduce((sum, tool) => sum + Math.max(0, tool.rawChars - serializeTool(tool)), 0);
}

/**
 * How much of a server's `instructions` blob the model is actually shown.
 *
 * 🔬 **Measured, not assumed.** 2026-09-02, Claude Code 2.1.237: the acme server returns 4,374
 * characters of `instructions` and the session's system prompt carried exactly the first 2,048 of
 * them, followed by `… [truncated]`. Two entries for the same server cut at the same offset, so
 * the limit is per server, and it is characters rather than tokens.
 *
 * Counting the whole blob would have charged acme for 2,326 characters nobody is ever shown,
 * 53% of the line item this tool calls the cheapest thing to fix, in the direction that flatters
 * the tool's own headline. The cap is applied when a row is costed rather than when a probe is
 * cached, so a cache written before this existed is corrected on read instead of going stale.
 */
export const INSTRUCTIONS_CAP = 2048;

/** Characters of an `instructions` blob that reach the model. */
export function countedInstructions(chars: number): number {
  return Math.min(chars, INSTRUCTIONS_CAP);
}

function instructionsOf(result: Record<string, unknown>): string {
  return typeof result.instructions === 'string' ? result.instructions : '';
}

function initializeParams(): Record<string, unknown> {
  return { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO };
}

/** Unwrap a JSON-RPC response, turning a protocol-level error into a thrown one. */
function unwrap(message: unknown): Record<string, unknown> {
  if (!isRecord(message)) throw new McpError('server sent a non-object response');
  if (isRecord(message.error)) {
    const text = typeof message.error.message === 'string' ? message.error.message : 'unknown error';
    throw new McpError(`server returned an error: ${text}`);
  }
  if (!isRecord(message.result)) throw new McpError('server sent a response with no result');
  return message.result;
}

function toolsFrom(result: Record<string, unknown>): { tools: RawTool[]; cursor: string | null } {
  const raw = Array.isArray(result.tools) ? result.tools : [];
  const tools: RawTool[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.name !== 'string') continue;
    tools.push({
      name: entry.name,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      inputSchema: entry.inputSchema,
      rawChars: JSON.stringify(entry).length,
    });
  }
  return { tools, cursor: typeof result.nextCursor === 'string' ? result.nextCursor : null };
}

/**
 * Remove every value we handed the server from text the server handed back.
 *
 * Short values are left alone: a two-character env value matches everywhere and redacting it would
 * shred the diagnostic without protecting anything that was secret to begin with.
 */
export function secretsOf(spec: McpLaunchSpec): string[] {
  return [...Object.values(spec.env), ...Object.values(spec.headers)];
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join('[redacted]');
  }
  return out;
}

/* ------------------------------------------------------------------------------------------- */
/* stdio                                                                                        */
/* ------------------------------------------------------------------------------------------- */

async function stdioProbe(spec: McpLaunchSpec, timeoutMs: number): Promise<ProbeResult> {
  if (spec.command === null) throw new McpError('no command to run');

  const secrets = secretsOf(spec);
  const child = spawn(spec.command, spec.args, {
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    // 🚨 **The child is almost never the server.** `npx pkg` and `bash -c '... node server.js'`
    // both fork the real process, so killing what we started leaves the grandchild running: it
    // keeps this process's pipes open, `context-tax` never exits, and a live MCP server is left
    // behind on the machine after a read-only measurement. `detached` makes the child a process
    // group leader so `stop` below can signal the whole tree at once.
    detached: process.platform !== 'win32',
  });

  /**
   * End the server and let go of its pipes.
   *
   * Both halves are needed. The negative pid signals the group rather than the one process we can
   * see, and destroying the streams releases the handles even where a grandchild outlives the
   * signal, which is what keeps the event loop from staying open on a process nobody is talking to.
   */
  const stop = (): void => {
    try {
      if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      // ESRCH: it is already gone, which is the outcome this function wanted.
    }
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  };

  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let stdout = '';
  let stderr = '';
  let settled: Error | null = null;

  const failAll = (error: Error): void => {
    settled ??= error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index !== -1) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      index = stdout.indexOf('\n');
      if (line === '') continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        // Servers are not supposed to log to stdout, and several do anyway. A line that is not
        // JSON is noise, not a protocol violation worth failing the measurement over.
        continue;
      }
      if (!isRecord(message) || typeof message.id !== 'number') continue;
      const waiter = pending.get(message.id);
      if (waiter === undefined) continue;
      pending.delete(message.id);
      waiter.resolve(message);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    // Only the tail is kept: a failing `npx` prints a whole install log, and the last few hundred
    // characters are the part that says why.
    stderr = (stderr + chunk).slice(-600);
  });

  child.on('error', (error: Error) => failAll(new McpError(`could not start: ${error.message}`)));
  child.on('exit', (code) => {
    const tail = redact(stderr.trim(), secrets)
      .split('\n')
      .map((entry) => entry.trim())
      // "A complete log of this run can be found in: …" is npm telling you where to look, which
      // is not the diagnosis and eats the whole line a row gets to explain itself.
      .filter((entry) => entry !== '' && !entry.includes('A complete log of this run'))
      .slice(-2)
      .join(' / ')
      .slice(0, 160);
    failAll(new McpError(`exited with code ${code ?? 'null'}${tail === '' ? '' : `: ${tail}`}`));
  });

  const timer = setTimeout(() => {
    failAll(new McpError(`no response within ${Math.round(timeoutMs / 1000)}s`));
    stop();
  }, timeoutMs);

  let nextId = 0;
  const call = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (settled !== null) return Promise.reject(settled);
    const id = (nextId += 1);
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return promise;
  };

  try {
    const initialized = unwrap(await call('initialize', initializeParams()));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

    const collected: RawTool[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = unwrap(await call('tools/list', cursor === null ? {} : { cursor }));
      const { tools, cursor: next } = toolsFrom(result);
      collected.push(...tools);
      if (next === null) break;
      cursor = next;
    }
    return { tools: collected, instructions: instructionsOf(initialized), transport: 'stdio' };
  } finally {
    clearTimeout(timer);
    // The child is a server: it will sit there forever if nobody tells it to stop.
    child.stdin.end();
    stop();
  }
}

/* ------------------------------------------------------------------------------------------- */
/* Shared SSE framing                                                                           */
/* ------------------------------------------------------------------------------------------- */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/** A promise whose settle handles are needed somewhere other than where it was created. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface SseEvent {
  event: string;
  data: string;
}

/** Incremental `text/event-stream` framing. Both HTTP transports need it, for different reasons. */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let split = this.buffer.indexOf('\n\n');
    while (split !== -1) {
      const block = this.buffer.slice(0, split);
      this.buffer = this.buffer.slice(split + 2);
      split = this.buffer.indexOf('\n\n');
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (data.length > 0) events.push({ event, data: data.join('\n') });
    }
    return events;
  }
}

async function* streamText(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * A failed request, with the server's own explanation attached.
 *
 * `HTTP 400 Bad Request` is not a diagnosis. The body behind one of these on this machine said
 * `unsupported_protocol_version`, which is the entire finding — so the body is read, trimmed and
 * scrubbed of anything we sent, and the row gets to say what is actually wrong.
 */
async function httpError(response: Response, spec: McpLaunchSpec): Promise<McpError> {
  let detail = '';
  try {
    detail = redact((await response.text()).trim(), secretsOf(spec)).replace(/\s+/g, ' ').slice(0, 200);
  } catch {
    // A body that cannot be read is not worth failing differently over.
  }
  return new McpError(`HTTP ${response.status} ${response.statusText}${detail === '' ? '' : `: ${detail}`}`);
}

/* ------------------------------------------------------------------------------------------- */
/* Streamable HTTP                                                                              */
/* ------------------------------------------------------------------------------------------- */

async function httpProbe(spec: McpLaunchSpec, timeoutMs: number): Promise<ProbeResult> {
  if (spec.url === null) throw new McpError('no url to contact');
  const url = spec.url;
  const signal = AbortSignal.timeout(timeoutMs);
  let sessionId: string | null = null;

  const post = async (body: Record<string, unknown>): Promise<unknown> => {
    const headers: Record<string, string> = {
      ...spec.headers,
      'content-type': 'application/json',
      // Either shape is legal for a response, so both are accepted and both are parsed below.
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    if (sessionId !== null) headers['mcp-session-id'] = sessionId;

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    const returned = response.headers.get('mcp-session-id');
    if (returned !== null) sessionId = returned;
    if (!response.ok) throw await httpError(response, spec);
    if (response.status === 202) return null;

    const text = await response.text();
    if (text.trim() === '') return null;
    if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      for (const event of new SseParser().push(`${text}\n\n`)) {
        const parsed: unknown = JSON.parse(event.data);
        if (isRecord(parsed) && parsed.id !== undefined) return parsed;
      }
      throw new McpError('event stream carried no response');
    }
    return JSON.parse(text) as unknown;
  };

  const initialized = unwrap(
    await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams() }),
  );
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const collected: RawTool[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = unwrap(
      await post({
        jsonrpc: '2.0',
        id: page + 2,
        method: 'tools/list',
        params: cursor === null ? {} : { cursor },
      }),
    );
    const { tools, cursor: next } = toolsFrom(result);
    collected.push(...tools);
    if (next === null) break;
    cursor = next;
  }
  return { tools: collected, instructions: instructionsOf(initialized), transport: 'http' };
}

/* ------------------------------------------------------------------------------------------- */
/* Legacy HTTP + SSE                                                                            */
/* ------------------------------------------------------------------------------------------- */

/**
 * The two-channel transport: responses come back down a GET stream opened before the first POST,
 * and the POST endpoint is announced on that stream rather than being derivable from the URL. So
 * the stream has to be open and pumping before anything can be asked, which is why this one is
 * structured around a background reader instead of a request/response pair like the other two.
 */
async function sseProbe(spec: McpLaunchSpec, timeoutMs: number): Promise<ProbeResult> {
  if (spec.url === null) throw new McpError('no url to contact');
  const base = spec.url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  /** The stream can die at any point, including between a POST and its answer. */
  const dead = deferred<never>();
  // Nothing may be waiting on it when it rejects, and an unhandled rejection would take the
  // process down over a server that merely hung up.
  dead.promise.catch(() => {});
  const endpointReady = deferred<string>();
  endpointReady.promise.catch(() => {});
  const pending = new Map<number, (message: unknown) => void>();

  try {
    const stream = await fetch(base, {
      method: 'GET',
      headers: { ...spec.headers, accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!stream.ok) throw await httpError(stream, spec);
    const body = stream.body;
    if (body === null) throw new McpError('server opened an empty stream');

    const fail = (error: unknown): void => {
      const wrapped = error instanceof Error ? error : new McpError(String(error));
      dead.reject(wrapped);
      endpointReady.reject(wrapped);
    };

    void (async (): Promise<void> => {
      const parser = new SseParser();
      for await (const chunk of streamText(body)) {
        for (const event of parser.push(chunk)) {
          if (event.event === 'endpoint') {
            endpointReady.resolve(new URL(event.data, base).toString());
            continue;
          }
          let message: unknown;
          try {
            message = JSON.parse(event.data);
          } catch {
            continue;
          }
          if (!isRecord(message) || typeof message.id !== 'number') continue;
          const waiter = pending.get(message.id);
          if (waiter === undefined) continue;
          pending.delete(message.id);
          waiter(message);
        }
      }
      fail(new McpError('stream closed before the server answered'));
    })().catch(fail);

    const target = await Promise.race([endpointReady.promise, dead.promise]);

    const send = (body_: Record<string, unknown>): Promise<Response> =>
      fetch(target, {
        method: 'POST',
        headers: { ...spec.headers, 'content-type': 'application/json' },
        body: JSON.stringify(body_),
        signal: controller.signal,
      });

    let nextId = 0;
    const call = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      const id = (nextId += 1);
      const answer = deferred<unknown>();
      pending.set(id, answer.resolve);
      const response = await send({ jsonrpc: '2.0', id, method, params });
      if (!response.ok) throw await httpError(response, spec);
      return Promise.race([answer.promise, dead.promise]);
    };

    const initialized = unwrap(await call('initialize', initializeParams()));
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const collected: RawTool[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = unwrap(await call('tools/list', cursor === null ? {} : { cursor }));
      const { tools, cursor: next } = toolsFrom(result);
      collected.push(...tools);
      if (next === null) break;
      cursor = next;
    }
    return { tools: collected, instructions: instructionsOf(initialized), transport: 'sse' };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/* ------------------------------------------------------------------------------------------- */

/**
 * Ask a server what it costs.
 *
 * 🔑 **The declared transport is a hint, not a fact, so a URL server that refuses one shape is
 * retried with the other.** `acme/.mcp.json` declares `context7` as `"type": "sse"` with the URL
 * `https://mcp.context7.com/mcp`, the *streamable HTTP* endpoint, which answers a legacy SSE GET
 * with `405 Method Not Allowed`.
 *
 * Without the retry the row comes back `unmeasured`, and that is the failure worth avoiding: a
 * measurement failure would be sitting in the column where a usage finding belongs, and the reader
 * has no way to tell the two apart. With the retry, context7 measures cleanly and then earns an
 * honest `never called` verdict from the evidence instead. Both of those are useful; a shrug in
 * the shape of an error is not.
 */
export async function probeServer(spec: McpLaunchSpec, timeoutMs: number): Promise<ProbeResult> {
  if (spec.transport === 'stdio') return stdioProbe(spec, timeoutMs);
  if (spec.url === null) throw new McpError('the config gives neither a command to run nor a url');

  const order: ('http' | 'sse')[] = spec.transport === 'sse' ? ['sse', 'http'] : ['http', 'sse'];
  let first: Error | null = null;
  // ⚠️ The budget is per SERVER, not per attempt. Two attempts each given the full timeout turns a
  // 10s promise into a 20s wait, which is exactly the hang `--no-spawn` exists to prevent.
  const deadline = Date.now() + timeoutMs;
  for (const attempt of order) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    try {
      return await (attempt === 'http' ? httpProbe(spec, left) : sseProbe(spec, left));
    } catch (error) {
      // The declared transport's failure is the one worth reporting; the fallback failing too just
      // means the fallback was not it either.
      first ??= error instanceof Error ? error : new McpError(String(error));
    }
  }
  throw first ?? new McpError('unreachable');
}
