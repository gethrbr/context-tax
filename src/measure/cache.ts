/**
 * The disk cache, and the reason there is one.
 *
 * A cold `npx <server>` took **90 seconds** in research. A tool whose pitch is `npx context-tax`
 * cannot hang for a minute and a half on first run, so every measurement is written down and the
 * second run is instant.
 *
 * 🔒 **The cache is the easiest place to leak a credential, so it holds none.** The key is a hash
 * of the launch spec: the command, its arguments, and its environment variable *names*. The value
 * holds only tool names and character counts. No command line, no URL, no environment, no headers,
 * not even the server's name. A cache entry read on its own says nothing about the machine it came
 * from.
 *
 * The arguments go into the hash but never into a stored value. Hashing them is required for
 * correctness, since `npx pkg@1` and `npx pkg@2` are different servers, and a hash is one-way, so
 * an `--api-key` sitting in an argument list is protected by the same property that makes the key
 * work at all.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { McpLaunchSpec } from '../resolve/types.js';
import type { MeasuredTool } from './types.js';

/**
 * 2 since 2026-09-02: a v1 entry knows what a tool's whole definition weighs but not what its name
 * and description weigh on their own, and the resident half of every server row is built from
 * exactly that. An entry without it is dropped rather than half-counted, which costs one re-probe.
 */
export const VERSION = 2;

/** Schemas move when a server updates. A week keeps a pinned `@latest` from going stale unnoticed. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedProbe {
  version: number;
  measuredAt: string;
  transport: string;
  instructionsChars: number;
  tools: MeasuredTool[];
}

export function cacheKey(spec: McpLaunchSpec): string {
  const canonical = [
    spec.transport,
    spec.command ?? '',
    ...spec.args,
    spec.url ?? '',
    // Names, sorted. A rotated token must not invalidate a schema that did not change.
    ...Object.keys(spec.env).sort(),
    ...Object.keys(spec.headers).sort(),
  ].join(' ');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function isCached(value: unknown): value is CachedProbe {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === VERSION && typeof record.measuredAt === 'string' && Array.isArray(record.tools)
  );
}

/** `maxAgeMs` of `Infinity` accepts any entry, which is what `--no-spawn` wants: stale beats blank. */
export async function readCache(
  dir: string,
  key: string,
  maxAgeMs: number,
  now: number,
): Promise<CachedProbe | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(dir, `${key}.json`), 'utf8'));
  } catch {
    // A missing or corrupt entry is a cache miss, which is a normal thing for a cache to have.
    return null;
  }
  if (!isCached(parsed)) return null;
  const age = now - Date.parse(parsed.measuredAt);
  if (Number.isNaN(age) || age > maxAgeMs) return null;
  return parsed;
}

export async function writeCache(dir: string, key: string, value: CachedProbe): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${key}.json`), `${JSON.stringify(value)}\n`, 'utf8');
  } catch {
    // An unwritable cache directory makes the tool slower, not wrong. Not worth an error.
  }
}
