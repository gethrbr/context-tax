/**
 * Reading config off disk without ever throwing, and without ever carrying a secret forward.
 *
 * Every function here treats an absent, unreadable or malformed file as an ANSWER rather than an
 * error: a machine with no `~/.claude/settings.json` is a normal machine, and a tool that dies on
 * one file cannot report on the other twelve.
 */

import { readFile } from 'node:fs/promises';

import type { Problem } from './types.js';

/** A JSON object read from disk, or `null` if it was absent, unreadable or not an object. */
export async function readJsonObject(
  path: string,
  problems: Problem[],
): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    // Absent is the common case and is not a problem worth reporting.
    return null;
  }
  try {
    // A byte-order mark is what a Windows editor leaves at the top of a file. JSON.parse rejects
    // it, and rejecting it here would drop every server the file declares, for a byte nobody sees.
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push({ path, message: 'expected a JSON object' });
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    problems.push({ path, message: `could not parse: ${jsonFault(error)}` });
    return null;
  }
}

/**
 * 🔒 What went wrong with a JSON file, without the file's own text.
 *
 * V8's message quotes about ten characters around the bad token, and a settings file's bad token
 * is as likely as not to sit beside a key. The position survives; the excerpt does not.
 */
export function jsonFault(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const at = /position (\d+)/.exec(message) ?? /line (\d+) column (\d+)/.exec(message);
  if (at === null) return 'not valid JSON';
  return at.length === 3 ? `not valid JSON at line ${at[1]}, column ${at[2]}` : `not valid JSON at position ${at[1]}`;
}

/**
 * Why a file could not be written, in words. The codes a settings directory or an `--svg` path
 * produces in practice each get a sentence; anything else keeps Node's own message, which for a
 * filesystem error names the operation and the path and nothing from the file.
 */
export function fsFault(error: unknown): string {
  const code = (error as { code?: string }).code;
  switch (code) {
    case 'ENOENT':
      return 'its directory does not exist';
    case 'EISDIR':
      return 'that is a directory';
    case 'EACCES':
    case 'EPERM':
      return 'permission denied';
    case 'EROFS':
      return 'the filesystem is read-only';
    case 'ENOSPC':
      return 'the disk is full';
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * 🔒 Strip a URL to the part that identifies a server: the scheme and the host, nothing after.
 *
 * Userinfo (`https://user:token@host`) and the query string are the obvious places a token is
 * parked. The path is the less obvious one: hosted MCP gateways hand out
 * `https://host/api/mcp/s/<secret>/mcp`, and this string reaches `config --json`. A URL we cannot
 * parse yields `null` rather than the raw string, because an unparseable URL is exactly the shape
 * most likely to be carrying something odd.
 */
export function safeUrl(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * `${VAR}` and `${VAR:-default}` in a server definition, expanded the way the client expands them.
 *
 * Claude Code substitutes these in `command`, `args`, `env`, `url` and `headers` before it starts a
 * server. Probing with the placeholder left in would report a working server as one that could not
 * start, and a URL of `${API_BASE}/mcp` is not a URL at all. A variable that is unset and has no
 * default is left as written, so the failure that follows names the placeholder.
 */
export function expandEnv(text: string, env: Record<string, string | undefined> = process.env): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name: string, fallback?: string) => {
    const value = env[name];
    if (value !== undefined) return value;
    if (fallback !== undefined) return fallback;
    return whole;
  });
}

/**
 * The one argument worth showing a human: the package or script a runner was told to run.
 *
 * 🔒 Taken only when the command is a runner (`npx`, `uvx`, `node`, ...), whose first positional
 * argument is a package or a script by definition, and only from the leading run of non-flag
 * arguments, abandoned at the first `-`. `--api-key sk-…` puts a secret in the argument *after* a
 * flag, so anything at or beyond the first flag is off limits; and a server started as its own
 * executable can take a token as its first positional, so for any other command there is no entry.
 * `npx -y @playwright/mcp@latest` still resolves, because a flag with no value is skipped rather
 * than ending the scan, but only for the handful of value-less flags that appear in front of a
 * package name.
 */
const VALUELESS_FLAGS = new Set(['-y', '--yes', '-q', '--quiet', '--silent']);
const RUNNERS = new Set(['npx', 'bunx', 'pnpx', 'node', 'bun', 'deno', 'python', 'python3', 'uv', 'uvx']);

export function entryArgument(command: string | null, args: string[]): string | null {
  if (command === null || !RUNNERS.has(command.split(/[\\/]/).pop() ?? '')) return null;
  for (const arg of args) {
    if (VALUELESS_FLAGS.has(arg)) continue;
    if (arg.startsWith('-')) return null;
    return arg;
  }
  return null;
}

/** Keys of a string-valued map, sorted. Used for `env` and `headers`, whose values never leave. */
export function keyNames(value: unknown): string[] {
  const record = asRecord(value);
  if (record === null) return [];
  return Object.keys(record).sort();
}

/** `env`/`headers` as real values, for the launch spec only. */
export function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (record === null) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

export interface Frontmatter {
  fields: Record<string, string>;
  /** Characters between the two `---` fences, so a caller can reason about what it did not read. */
  chars: number;
}

/**
 * Parse the leading `---` block of a markdown file.
 *
 * Deliberately NOT a YAML parser — a dependency, and a general one would accept nested structures
 * this format does not use. It reads `key: value` pairs and folds continuation lines, which is
 * every frontmatter shape Claude Code writes. A file with no fence yields `null`, which is how a
 * plain note is told apart from a skill: **`~/.claude/skills` on this machine holds 30 bare `.md`
 * notes beside 3 real skills**, and counting files rather than frontmatter would have reported 33.
 */
export function parseFrontmatter(text: string): Frontmatter | null {
  if (!text.startsWith('---')) return null;
  const afterOpen = text.indexOf('\n');
  if (afterOpen === -1) return null;
  // The opening fence must be `---` alone on its line, or this is a horizontal rule.
  if (text.slice(0, afterOpen).trim() !== '---') return null;

  const close = text.indexOf('\n---', afterOpen);
  if (close === -1) return null;
  const block = text.slice(afterOpen + 1, close);

  const fields: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (match) {
      currentKey = match[1];
      fields[currentKey] = match[2].trim();
      continue;
    }
    // A continuation: descriptions routinely wrap, and dropping the tail would understate the line.
    if (currentKey !== null && /^\s+\S/.test(line)) {
      fields[currentKey] = `${fields[currentKey]} ${line.trim()}`.trim();
    }
  }
  return { fields, chars: block.length };
}
