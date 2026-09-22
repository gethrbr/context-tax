/**
 * The screens made to leave the machine: the first line, the receipt, and the session picture.
 *
 * They share one rule the main table does not have. The table names servers, plugins and paths,
 * because whoever reads it is about to edit them. These three are read by strangers, so what they
 * may carry is decided here and pinned: kinds and numbers, never a name or a path.
 *
 * 🔒 Everything below is drawn from the fabricated README fixture or from an invented series.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { SessionSeries } from '../evidence/series.js';
import { palette } from '../render/color.js';
import { renderLedger } from '../render/ledger.js';
import { renderReceipt } from '../render/receipt.js';
import { renderSession, renderSessionSvg, sessionCaption } from '../render/session.js';
import { readmeLedger } from './fixtures/readme-ledger.js';
import { readmeSeries } from './fixtures/readme-series.js';

const plain = palette(false);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the first line', () => {
  it('says the share of the window, and prints the window it is a share of', () => {
    // One sentence pair, wrapped to the terminal, so it is compared with the wrapping taken out.
    const screen = renderLedger(readmeLedger(), plain, 100).replace(/\s+/g, ' ');
    expect(screen).toContain(
      '40,000 tokens on every turn, 20% of a window of about 200,000, before you type a word. ' +
        '1,900 of them are recoverable from the 7 findings below.',
    );
  });

  it('🚨 prints no percentage at all when no session proves the window', () => {
    // "31% of your window" was once said against an assumed 200,000 on a machine running 750,000.
    const screen = renderLedger({ ...readmeLedger(), windowTokens: null }, plain, 100);
    expect(screen).toContain('40,000 tokens on every turn, 1,900 of them recoverable');
    expect(screen.split('\n').slice(0, 8).join('\n')).not.toMatch(/%/);
  });

  it('never rounds a small prefix down to 0% of the window', () => {
    const screen = renderLedger({ ...readmeLedger(), windowTokens: 100_000_000 }, plain, 100);
    expect(screen).toContain('1% of a window');
  });
});

describe('what the table says about where its rows came from', () => {
  it('names the session the rows were read from', () => {
    expect(renderLedger(readmeLedger(), plain, 100)).toContain(
      'Rows are what your session of 2026-09-01 sent, read from its transcript.',
    );
  });

  it('🚨 says the rows were weighed, not read, when no session recorded what it sent', () => {
    const screen = renderLedger({ ...readmeLedger(), source: { kind: 'measured' } }, plain, 100);
    expect(screen).toContain('Rows are weighed from your config, because no session here recorded what it sent.');
    expect(screen).not.toContain('read from its transcript');
  });

  it("puts the client's own rows under its name, so `its 14 tools` says whose", () => {
    const lines = renderLedger(readmeLedger(), plain, 100).split('\n');
    const title = lines.findIndex((line) => line.includes('CLAUDE CODE ITSELF'));
    expect(title).toBeGreaterThan(0);
    expect(lines[title + 1]).toContain('its 14 tools');
  });
});

describe('the receipt', () => {
  const receipt = renderReceipt(readmeLedger(), plain, '2026-09-02');

  it('🔒 carries kinds and numbers, and not one server, plugin, skill or path', () => {
    for (const name of ['figma', 'github', 'linear', 'sentry', 'postgres', 'Notion', 'design-kit', 'release-notes']) {
      expect(receipt).not.toContain(name);
    }
    expect(receipt).not.toMatch(/~\/|\/Users\/|\/home\/|storefront|settings/);
  });

  it('counts every server a row stands for, and leaves out the ones that cost nothing', () => {
    // Five rows with a number. `postgres` has none, so it is not on a receipt of what was paid.
    expect(receipt).toContain('MCP servers (5)');
    const grouped = readmeLedger();
    grouped.rows.push({ ...grouped.rows[0], label: '4 small connectors', count: 4, tokens: 80 });
    expect(renderReceipt(grouped, plain, '2026-09-02')).toContain('MCP servers (9)');
  });

  it('lists the largest line first and the remainder last, over the exact total', () => {
    const lines = receipt.split('\n').map((line) => line.trim());
    const at = (text: string): number => lines.findIndex((line) => line.startsWith(text));
    expect(at("Claude Code's own tools (14)")).toBeLessThan(at("Claude Code's system prompt"));
    expect(at('Not itemised')).toBeGreaterThan(at('Your hooks'));
    expect(lines.find((line) => line.startsWith('TOTAL PER TURN'))).toMatch(/40,000$/);
    expect(receipt).toContain('20% of a window of about 200,000 tokens');
  });

  it('says how many skills went without a description, under the line it belongs to', () => {
    const lines = receipt.split('\n');
    const skills = lines.findIndex((line) => line.includes('Skill listing (31)'));
    expect(lines[skills + 1]).toContain('9 sent as a name, no description');
  });

  it('adds up: the lines and the remainder are the total', () => {
    const numbers = receipt
      .split('\n')
      .filter((line) => /^\s{2}\S/.test(line) && /\d$/.test(line))
      .map((line) => ({ label: line.trim(), value: Number(line.trim().split(/\s+/).pop()?.replace(/,/g, '')) }));
    const total = numbers.find((entry) => entry.label.startsWith('TOTAL PER TURN'))?.value;
    const lines = numbers.slice(0, numbers.findIndex((entry) => entry.label.startsWith('TOTAL PER TURN')));
    expect(lines.reduce((sum, entry) => sum + entry.value, 0)).toBe(total);
  });

  it('fits a phone screenshot: no line wider than the receipt', () => {
    for (const line of receipt.split('\n')) expect(line.length).toBeLessThanOrEqual(48);
  });

  /**
   * 🚨 A listing read from a session newer than the ones the total is billed from can outrun the
   * total. The main screen refuses that sum in red; the receipt printed the rows and the smaller
   * total and said nothing, on the one screen built to be shared.
   */
  it('says so when its rows sum past the total, and still fits', () => {
    const grown = readmeLedger();
    grown.reconciliation = { ...grown.reconciliation, total: 8_000, unattributed: null, overAttributed: true };
    const screen = renderReceipt(grown, plain, '2026-09-02');
    expect(screen).toContain('rows sum past the total');
    expect(screen).not.toContain('Not itemised');
    for (const line of screen.split('\n')) expect(line.length).toBeLessThanOrEqual(48);
    expect(receipt).not.toContain('rows sum past the total');
  });

  it('matches the README, character for character', async () => {
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
    const after = readme.slice(readme.indexOf('## The receipt'));
    // The section opens with a ```bash block for the command. The screen is the first untagged one.
    const fenced = [...after.matchAll(/```([a-z]*)\n([\s\S]*?)\n```/g)];
    const screen = fenced.find((match) => match[1] === '');
    expect(screen?.[2].trim()).toBe(receipt.trim());
  });
});

describe('the session picture', () => {
  const view = { series: readmeSeries(), openedAt: 40_000 };

  it('says the four numbers the picture is about, the same way in both forms', () => {
    expect(sessionCaption(view)).toBe('640 turns, peak 186,000 tokens, compacted 4 times, and never under 41,200.');
    expect(renderSession(view, plain, 100)).toContain(sessionCaption(view));
    expect(renderSessionSvg(view)).toContain(`aria-label="${sessionCaption(view)}"`);
  });

  it('marks each compaction under the turn it happened on', () => {
    const axis = renderSession(view, plain, 100).split('\n').find((line) => line.includes('└'));
    expect(axis?.split('▴').length).toBe(5);
  });

  it('draws nothing for a session with no shape to draw', () => {
    const empty: SessionSeries = { turns: [50_000], compactions: [], firstSeen: null, lastSeen: null };
    expect(renderSession({ series: empty, openedAt: null }, plain, 100)).toContain('too few turns to draw');
  });

  it('🔒 puts no path, id or project name in the image', () => {
    const svg = renderSessionSvg(view);
    expect(svg).not.toMatch(/\/Users\/|\/home\/|~\/|\.jsonl|storefront/);
    expect(svg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('is one self-contained file: nothing is fetched, linked or scripted', () => {
    const svg = renderSessionSvg(view);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toMatch(/<script|<image|href=|url\(|@import|<foreignObject/);
  });

  it('matches the terminal screen in the README, character for character', async () => {
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
    const after = readme.slice(readme.indexOf('## One session as a picture'));
    const fenced = [...after.matchAll(/```([a-z]*)\n([\s\S]*?)\n```/g)];
    const screen = fenced.find((match) => match[1] === '');
    expect(screen?.[2].trim()).toBe(renderSession(view, plain, 80).trim());
  });

  it('matches the image in the README, byte for byte', async () => {
    expect(await readFile(join(packageRoot, 'docs', 'session.svg'), 'utf8')).toBe(renderSessionSvg(view));
  });
});
