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
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push({ path, message: 'expected a JSON object' });
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    problems.push({ path, message: `could not parse: ${(error as Error).message}` });
    return null;
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
 * 🔒 Strip a URL to the part that identifies a server.
 *
 * Userinfo (`https://user:token@host`) and the query string are both places a token is routinely
 * parked, and both are dropped. A URL we cannot parse yields `null` rather than the raw string —
 * an unparseable URL is exactly the shape most likely to be carrying something odd.
 */
export function safeUrl(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * The one argument worth showing a human: the package or script being run.
 *
 * 🔒 Taken only from the leading run of non-flag arguments, and abandoned at the first `-`. That
 * is not stylistic — `--api-key sk-…` puts a secret in the argument *after* a flag, so anything at
 * or beyond the first flag is off limits. `npx -y @playwright/mcp@latest` still resolves, because
 * a flag with no value is skipped rather than ending the scan, but only for the handful of
 * value-less flags that actually appear in front of a package name.
 */
const VALUELESS_FLAGS = new Set(['-y', '--yes', '-q', '--quiet', '--silent']);

export function entryArgument(args: string[]): string | null {
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
