/**
 * What the screens promise about their own shape.
 *
 * 🚨 Every test here pins the same bug, reported twice by the person looking at the output: the
 * renderers were written as if the terminal were infinitely wide. Prose ran past the edge and
 * wrapped back to column 0, and a table row that overflowed by one character took the whole grid
 * with it. Both were invisible to a test suite that only ever asserted on substrings.
 */

import { describe, expect, it } from 'vitest';

import type { Ledger } from '../ledger/types.js';
import type { MeasureResult } from '../measure/types.js';
import type { ResolvedConfig } from '../resolve/types.js';
import { palette } from '../render/color.js';
import { hangingText, screenWidth, shortPath, wrapClamped, wrapText } from '../render/layout.js';
import { renderLedger } from '../render/ledger.js';
import { renderMeasure } from '../render/measure.js';
import { renderTable, tableWidth } from '../render/table.js';

const plain = palette(false);

/** A server that fails with a wall of JSON, which is the real shape that broke the layout. */
const JSON_ERROR =
  'HTTP 400 Bad Request: {"error":"unsupported_protocol_version","message":"Unsupported MCP protocol version"}';

function ledgerFixture(): Ledger {
  return {
    cwd: '/Users/somebody/a/deeply/nested/checkout/of/a/repository/with/a/long/name',
    actions: [],
    reconciliation: {
      total: 55_065,
      attributed: 12_275,
      unattributed: 42_790,
      overAttributed: false,
      window: '10 most recent sessions, 2026-09-01 to 2026-09-02',
      sessions: 10,
    },
    rows: [
      {
        label: 'a-server-with-a-very-long-name-indeed',
        kind: 'mcp-server',
        tokens: 1_460,
        loadedTokens: 3_558,
        share: 0.03,
        calls: 7,
        perCall: 6_921_651,
        verdict: {
          kind: 'rarely-called',
          calls: 7,
          sessions: 122,
          perCall: 6_921_651,
          window: 'since it was configured',
        },
        fix: null,
      },
      {
        label: 'broken',
        kind: 'mcp-server',
        tokens: null,
        loadedTokens: null,
        share: null,
        calls: 0,
        perCall: null,
        verdict: { kind: 'broken', reason: JSON_ERROR },
        fix: null,
      },
      {
        label: '3 memory files',
        kind: 'memory',
        tokens: 2_282,
        loadedTokens: null,
        share: 0.04,
        calls: null,
        perCall: null,
        verdict: {
          kind: 'not-attributable',
          why: 'the model reads these, it does not call them, so no log can say which lines were used',
        },
        fix: null,
      },
    ],
    findings: [
      {
        headline: 'a-server-with-a-very-long-name-indeed is loaded on every turn and used in 7 of 122 sessions',
        detail: `1,460 tokens re-sent across 33,189 turns for 7 calls. ${JSON_ERROR}`,
        saves: 1_460,
        fix: 'add "a-server-with-a-very-long-name-indeed" to disabledMcpjsonServers in /Users/somebody/a/deeply/nested/checkout/.claude/settings.local.json',
        actions: [],
      },
    ],
    recoverable: 1_460,
    problems: [{ path: '/Users/somebody/a/deeply/nested/checkout/.mcp.json', message: JSON_ERROR }],
  };
}

function measureFixture(): { config: ResolvedConfig; measure: MeasureResult } {
  const config: ResolvedConfig = {
    cwd: '/Users/somebody/a/deeply/nested/checkout',
    repoRoot: '/Users/somebody/a/deeply/nested/checkout',
    settingsTarget: '/Users/somebody/a/deeply/nested/checkout/.claude/settings.local.json',
    sources: [],
    mcpServers: [],
    skills: [],
    agents: [],
    commands: [],
    memory: [],
    plugins: [],
    problems: [],
  };
  const measure: MeasureResult = {
    contacted: [],
    spawned: [],
    servers: [
      {
        name: 'a-server-with-a-very-long-name-indeed',
        status: { kind: 'cached', at: '2026-09-02T00:00:00.000Z' },
        toolCount: 8,
        chars: 14_231,
        tokens: 3_558,
        residentChars: 5_840,
        residentTokens: 1_460,
        instructionsChars: 2_048,
        instructionsDroppedChars: 2_326,
        unsentChars: 0,
        transportUsed: 'stdio',
        tools: [{ name: 'one', chars: 14_231, listingChars: 5_840 }],
      },
      {
        name: 'broken',
        status: { kind: 'unmeasured', reason: JSON_ERROR, cause: 'failed' },
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
      },
    ],
    skills: { items: 20, chars: 5_392, tokens: 1_348 },
    agents: { items: 19, chars: 17_028, tokens: 4_257 },
    memory: { items: 3, chars: 9_127, tokens: 2_282 },
    measuredTokens: 3_558,
    residentTokens: 1_460,
    unsplit: 0,
    unmeasured: 1,
    problems: [],
  };
  return { config, measure };
}

const WIDTHS = [64, 72, 80, 96];

describe('every screen fits the window it was given', () => {
  it.each(WIDTHS)('🚨 renders the ledger inside %i columns', (width) => {
    const over = renderLedger(ledgerFixture(), plain, width)
      .split('\n')
      .filter((line) => line.length > width);
    expect(over).toEqual([]);
  });

  it.each(WIDTHS)('🚨 renders measure inside %i columns', (width) => {
    const { config, measure } = measureFixture();
    const over = renderMeasure(config, measure, plain, width)
      .split('\n')
      .filter((line) => line.length > width);
    expect(over).toEqual([]);
  });

  it('🚨 keeps one row on one line, however long the reason behind it is', () => {
    // The reason a bordered table is worth the ink: a row that carried its own explanation put a
    // sentence between every pair of numbers, and the columns stopped reading as a table.
    const rows = renderLedger(ledgerFixture(), plain, 80)
      .split('\n')
      .filter((line) => line.trimStart().startsWith('│'));
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) expect(row.trimEnd().endsWith('│')).toBe(true);
    // Every drawn line is the same width, which is the property a broken cell breaks first.
    const widths = new Set(rows.map((row) => row.length));
    expect(widths.size).toBe(1);
  });

  it('says the whole of a long error somewhere, even though no cell holds it', () => {
    const screen = renderLedger(ledgerFixture(), plain, 80);
    expect(screen).toContain('unsupported_protocol_version');
  });
});

describe('the table', () => {
  const columns = [
    { header: 'name', width: 8, align: 'left' as const },
    { header: 'n', width: 4, align: 'right' as const },
  ];

  it('draws every line at exactly the width it advertises', () => {
    const lines = renderTable(
      columns,
      [{ text: 'name' }, { text: 'n' }],
      [[[{ text: 'a' }, { text: '1' }]]],
      plain,
    );
    for (const line of lines) expect(line.length).toBe(tableWidth(columns));
  });

  it('ellipsises a cell that does not fit instead of pushing the row wider', () => {
    const [, , , row] = renderTable(
      columns,
      [{ text: 'name' }, { text: 'n' }],
      [[[{ text: 'far-too-long-to-fit' }, { text: '1' }]]],
      plain,
    );
    expect(row).toContain('far-too…');
    expect(row.length).toBe(tableWidth(columns));
  });

  it('pads a row that supplies fewer cells than there are columns', () => {
    const [, , , row] = renderTable(columns, [{ text: '' }, { text: '' }], [[[{ text: 'a' }]]], plain);
    expect(row.length).toBe(tableWidth(columns));
  });
});

describe('wrapping', () => {
  it('breaks on words and never exceeds the width', () => {
    for (const line of wrapText('the quick brown fox jumps over the lazy dog', 12)) {
      expect(line.length).toBeLessThanOrEqual(12);
    }
  });

  it('splits a word with no spaces in it, because a JSON body is one word', () => {
    const lines = wrapText(JSON_ERROR, 20);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
    expect(lines.join('')).toContain('unsupported_protocol_version');
  });

  it('caps at a line count and marks the cut, rather than running on', () => {
    const lines = wrapClamped(JSON_ERROR, 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
  });

  it('hangs continuation lines under the first one', () => {
    const [first, second] = hangingText('one two three four five six seven', 20, 4, 2);
    expect(first.startsWith('    o')).toBe(true);
    expect(second.startsWith('      ')).toBe(true);
  });

  it('shortens a path from the home directory, and loses its middle before its name', () => {
    expect(shortPath('/home/me/a/b.json', 40, '/home/me')).toBe('~/a/b.json');
    const long = shortPath(`/home/me/${'x'.repeat(80)}/settings.json`, 30, '/home/me');
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long.endsWith('settings.json')).toBe(true);
  });

  it('clamps the window: unreadably wide is as bad as unusably narrow', () => {
    expect(screenWidth(400)).toBeLessThanOrEqual(96);
    expect(screenWidth(20)).toBeGreaterThanOrEqual(64);
    expect(screenWidth(undefined)).toBe(80);
  });
});

/**
 * The first screen a stranger sees. `npx context-tax` in a directory on a machine with no Claude
 * config at all has to read as "there is nothing here", not as a tool that half works.
 */
describe('a machine with nothing on it', () => {
  function emptyLedger(): Ledger {
    const base = ledgerFixture();
    return {
      ...base,
      actions: [],
      findings: [],
      rows: base.rows
        .filter((row) => row.kind === 'memory')
        .map((row) => ({ ...row, tokens: 0, share: null })),
      reconciliation: { ...base.reconciliation, total: null, attributed: 0, unattributed: null },
    };
  }

  // 🚨 Zero memory files used to print "your memory and instruction files are 0 tokens of every
  // turn. This tool can tell you what they cost." A caveat about the limits of measuring nothing
  // is indistinguishable from a bug, and it was the first thing a new user would have read.
  it('🚨 drops the memory caveat when there are no memory files to caveat', () => {
    const screen = renderLedger(emptyLedger(), plain, 80);
    expect(screen).not.toContain('0 tokens of every turn');
    expect(screen).not.toContain('This tool can tell you what they cost');
    // The connector caveat is true on any machine, so it stays and the section keeps a body.
    expect(screen).toContain('NOT MEASURABLE HERE');
    expect(screen).toContain('appear in no file');
  });

  it('still gives the caveat to a machine that has memory files', () => {
    const screen = renderLedger(ledgerFixture(), plain, 80);
    expect(screen).toContain('2,282 tokens of every turn');
  });

  /** Nothing loaded here AND no session history to join it against. The first-contact run. */
  function nothingLedger(): Ledger {
    const base = emptyLedger();
    return { ...base, problems: [], reconciliation: { ...base.reconciliation, sessions: 0 } };
  }

  // 🚨 The run a stranger is most likely to make first: `npx context-tax` in a directory
  // that has nothing to do with their agent. It drew the full grid with `0` or `-` in every cell,
  // which reads as a tool that is broken rather than as a machine with nothing on it. Nobody runs
  // a tool a second time after that.
  it('🚨 says there is nothing here instead of drawing a table of zeros', () => {
    const screen = renderLedger(nothingLedger(), plain, 80);
    expect(screen).toContain('NOTHING TO MEASURE HERE');
    // It has to say what to do next, not only that it found nothing.
    expect(screen).toContain('--cwd');
    // Not one border character, so there is no empty grid left on screen to misread.
    expect(screen).not.toContain('┌');
    expect(screen).not.toContain('│');
    // And no legend for columns that are not being printed.
    expect(screen).not.toContain('deferred');
    // A caveat about what could not be measured is noise when nothing was measured at all.
    expect(screen).not.toContain('NOT MEASURABLE HERE');
  });

  it('goes back to the full screen as soon as there is history to join against', () => {
    const base = nothingLedger();
    const screen = renderLedger(
      { ...base, reconciliation: { ...base.reconciliation, sessions: 10 } },
      plain,
      80,
    );
    expect(screen).not.toContain('NOTHING TO MEASURE HERE');
    expect(screen).toContain('┌');
  });

  // A file we choked on is news whether or not anything else was found, and the early return is
  // exactly the path that would have dropped it silently.
  it('still reports a file it could not read, with nothing else to report', () => {
    const screen = renderLedger(
      {
        ...nothingLedger(),
        problems: [{ path: '/Users/somebody/project/.mcp.json', message: JSON_ERROR }],
      },
      plain,
      80,
    );
    expect(screen).toContain('NOTHING TO MEASURE HERE');
    expect(screen).toContain('PROBLEMS');
    expect(screen).toContain('unsupported_protocol_version');
  });
});
