/**
 * The same ledger as a receipt.
 *
 * 🔑 Built to be shared, which decides what is on it. The main screen names servers, plugins and
 * paths because the person reading it is about to edit them. A receipt is read by strangers, so it
 * carries **kinds and numbers only**: "MCP servers (9)", never which nine. Everything identifying
 * is left on the screen that needs it.
 *
 * It adds nothing the ledger does not already hold. It is a different cut of the same rows: grouped
 * by kind, largest first, with the remainder last and the total under a rule.
 */

import type { Ledger, LedgerRow } from '../ledger/types.js';
import type { Palette } from './color.js';

const n = (value: number): string => value.toLocaleString('en-US');

/** Narrow on purpose. A receipt is a column, and a column is what fits a phone screenshot. */
const WIDTH = 46;

function compact(value: number): string {
  if (value < 1_000_000) return n(value);
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

interface Item {
  label: string;
  tokens: number;
  note: string | null;
}

const counted = (row: LedgerRow): string => (row.count === undefined ? '' : ` (${n(row.count)})`);

function itemsOf(ledger: Ledger): Item[] {
  const items: Item[] = [];
  const sum = (rows: LedgerRow[]): number => rows.reduce((total, row) => total + (row.tokens ?? 0), 0);
  const kind = (wanted: LedgerRow['kind']): LedgerRow[] => ledger.rows.filter((row) => row.kind === wanted);

  const servers = kind('mcp-server').filter((row) => (row.tokens ?? 0) > 0);
  // A row can stand for several servers: the small connectors share one.
  const serverCount = servers.reduce((total, row) => total + (row.count ?? 1), 0);
  if (servers.length > 0) items.push({ label: `MCP servers (${serverCount})`, tokens: sum(servers), note: null });

  for (const row of kind('skills')) {
    items.push({
      label: `Skill listing${counted(row)}`,
      tokens: row.tokens ?? 0,
      note:
        ledger.neverReceived === null
          ? null
          : `${n(ledger.neverReceived.dropped)} sent as a name, no description`,
    });
  }
  for (const row of kind('agents')) items.push({ label: `Agent listing${counted(row)}`, tokens: row.tokens ?? 0, note: null });
  for (const row of kind('memory')) items.push({ label: `Instruction files${counted(row)}`, tokens: row.tokens ?? 0, note: null });
  for (const row of kind('hooks')) items.push({ label: 'Your hooks', tokens: row.tokens ?? 0, note: null });

  // The client's own rows keep their identity where it is the point, and fold where it is not.
  const client = kind('client');
  for (const row of client.filter((one) => one.part === 'tools')) {
    items.push({ label: `Claude Code's own tools${counted(row)}`, tokens: row.tokens ?? 0, note: null });
  }
  const prompt = client.filter((row) => row.part === 'system-prompt');
  if (prompt.length > 0) items.push({ label: "Claude Code's system prompt", tokens: sum(prompt), note: null });
  const rest = client.filter((row) => row.part !== 'tools' && row.part !== 'system-prompt');
  if (rest.length > 0) items.push({ label: 'Tool names, session details', tokens: sum(rest), note: null });

  return items.filter((item) => item.tokens > 0).sort((a, b) => b.tokens - a.tokens);
}

export function renderReceipt(ledger: Ledger, colour: Palette, today: string): string {
  const out: string[] = [];
  const rule = colour.dim('-'.repeat(WIDTH));
  const centre = (text: string): string => ' '.repeat(Math.max(0, Math.floor((WIDTH - text.length) / 2))) + text;
  const pair = (label: string, value: string, paint: (text: string) => string = (text) => text): string => {
    const gap = Math.max(1, WIDTH - label.length - value.length);
    return `  ${paint(label)}${' '.repeat(gap)}${paint(value)}`;
  };

  const { total, unattributed, overAttributed } = ledger.reconciliation;
  const items = itemsOf(ledger);

  out.push('');
  out.push(`  ${colour.bold(centre('CONTEXT TAX'))}`);
  out.push(`  ${colour.dim(centre('sent on every turn, before you type'))}`);
  out.push(`  ${rule}`);
  for (const item of items) {
    out.push(pair(item.label, n(item.tokens)));
    if (item.note !== null) out.push(`    ${colour.yellow(item.note)}`);
  }
  if (!overAttributed && unattributed !== null && unattributed > 0) {
    out.push(pair('Not itemised', n(unattributed), colour.dim));
  }
  out.push(`  ${rule}`);

  if (total === null) {
    const measured = items.reduce((sum, item) => sum + item.tokens, 0);
    out.push(pair('MEASURED HERE', n(measured), colour.bold));
    out.push(`  ${colour.dim('no session here recorded a cold start,')}`);
    out.push(`  ${colour.dim('so there is no billed total to set it against')}`);
  } else {
    out.push(pair('TOTAL PER TURN', n(total), colour.bold));
    if (ledger.windowTokens !== null && ledger.windowTokens > 0) {
      const share = Math.max(1, Math.round((total / ledger.windowTokens) * 100));
      out.push(`  ${colour.dim(`${share}% of a window of about ${n(ledger.windowTokens)} tokens`)}`);
    }
  }
  out.push(`  ${rule}`);

  if (ledger.machine.turns > 0) {
    out.push(pair('PAID', `${n(ledger.machine.turns)} turns`));
    out.push(pair('', `${compact(ledger.machine.contextTokens)} tokens carried`, colour.dim));
  }
  if (ledger.recoverable > 0) out.push(pair('RECOVERABLE PER TURN', n(ledger.recoverable), colour.green));
  if (ledger.machine.turns > 0 || ledger.recoverable > 0) out.push(`  ${rule}`);

  out.push(pair('npx context-tax', today, colour.dim));
  out.push(
    `  ${colour.dim(
      ledger.source.kind === 'record'
        ? 'read from what a session sent · chars/4'
        : 'weighed from your config · chars/4',
    )}`,
  );
  out.push('');
  return out.join('\n');
}
