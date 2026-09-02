/**
 * What `--no-spawn` falls back to.
 *
 * `--no-spawn` exists so the tool can answer without starting anything: on a locked-down machine,
 * in CI, or when you simply do not want six servers launched to be told what they cost. The price
 * of that is that the numbers come from somewhere other than your machine, and every row that uses
 * this table is marked `estimated` and carries the date below.
 *
 * 🔑 **These are measurements, not guesses.** Each was taken with this file's own client, against
 * the real published server, on the date recorded. They will drift as those servers ship new
 * versions, which is exactly why the status is `estimated` and not `measured`: a number that was
 * true last month is not the same kind of fact as one that was true a second ago.
 *
 * Only public servers appear here. A private endpoint's tool count is a fact about somebody's
 * deployment, and this table ships to everyone.
 */

import { entryArgument } from '../resolve/read.js';
import type { McpLaunchSpec } from '../resolve/types.js';

export interface FallbackEntry {
  /** npm package name for stdio servers, hostname for remote ones. */
  id: string;
  toolCount: number;
  schemaChars: number;
  /**
   * Names and descriptions only: what these tools weigh while the client defers their schemas.
   *
   * 🔑 **Measured per server, because the ratio is not a constant.** Re-probed 2026-09-02, the
   * listing is 13% of the schema for `@playwright/mcp` and 69% for `server-sequential-thinking`.
   * Anything derived from an average would have been a guess wearing a measurement's clothes.
   * `null` where the row predates the re-probe and the server could not be reached without a
   * credential, and a `null` here makes the whole row's resident figure `null` rather than low.
   */
  listingChars: number | null;
  instructionsChars: number;
  measuredAt: string;
}

export const FALLBACK_TABLE: readonly FallbackEntry[] = [
  { id: '@playwright/mcp', toolCount: 24, schemaChars: 15896, listingChars: 2031, instructionsChars: 0, measuredAt: '2026-09-02' },
  { id: 'chrome-devtools-mcp', toolCount: 29, schemaChars: 22904, listingChars: 3181, instructionsChars: 0, measuredAt: '2026-09-02' },
  { id: '@modelcontextprotocol/server-filesystem', toolCount: 14, schemaChars: 7972, listingChars: 4311, instructionsChars: 0, measuredAt: '2026-09-02' },
  { id: '@modelcontextprotocol/server-sequential-thinking', toolCount: 1, schemaChars: 4034, listingChars: 2799, instructionsChars: 0, measuredAt: '2026-09-02' },
  // Needs an API key to answer, so the 2026-09-02 re-probe could not reach it and left the split open.
  { id: 'mcp.context7.com', toolCount: 2, schemaChars: 4583, listingChars: null, instructionsChars: 632, measuredAt: '2026-09-01' },
];

/** `@playwright/mcp@latest` names a package; `@latest` is a version, and only the package matches. */
export function packageOf(entry: string): string {
  const at = entry.lastIndexOf('@');
  if (at <= 0) return entry;
  return entry.slice(0, at);
}

export function fallbackFor(spec: McpLaunchSpec): FallbackEntry | null {
  if (spec.transport === 'stdio') {
    const entry = entryArgument(spec.args);
    if (entry === null) return null;
    const name = packageOf(entry);
    return FALLBACK_TABLE.find((row) => row.id === name) ?? null;
  }
  if (spec.url === null) return null;
  let host: string;
  try {
    host = new URL(spec.url).hostname;
  } catch {
    return null;
  }
  return FALLBACK_TABLE.find((row) => row.id === host) ?? null;
}
