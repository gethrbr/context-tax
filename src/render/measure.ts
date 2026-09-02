/**
 * `context-tax measure` - what the loaded config weighs.
 *
 * This screen is deliberately not the ledger. It prints cost without a verdict, because the
 * verdict needs the join against evidence that M4 builds, and a cost screen that started
 * recommending things on cost alone would be recommending you delete the server you use most.
 *
 * 🔑 Two things are always on screen, never behind a flag:
 *
 *  - **Every unmeasured row, with the server's own explanation.** A server that did not answer is
 *    the most interesting row on the page, not an omission to tidy away.
 *  - **What was started and who was contacted.** "Nothing leaves your machine" has to survive
 *    meeting a remote MCP server, and the way it survives is by naming the hosts out loud.
 */

import type { MeasureResult, MeasuredMcpServer } from '../measure/types.js';
import { PROVISIONAL_NOTE } from '../measure/tokens.js';
import type { ResolvedConfig } from '../resolve/types.js';
import type { Palette } from './color.js';
import { hangingText, screenWidth, wrapClamped } from './layout.js';
import type { Cell, Column, Section } from './table.js';
import { renderTable } from './table.js';

const n = (value: number): string => value.toLocaleString('en-US');

/**
 * The columns, and the one that only appears when the window can hold it.
 *
 * `chars` is diagnostic: it is where the token numbers come from, but it is not what anybody is
 * deciding on. On a narrow window it is dropped rather than allowed to squeeze the server name
 * down to something you cannot recognise, and the characters still appear in the note under the
 * row that carries the instructions blob.
 */
const STATUS = 14;
const TOOLS = 5;
const CHARS = 8;
const TOKENS = 8;
/** The resident column, the same width as `TOKENS` so the two token columns read as a pair. */
const RESIDENT = 8;
/** Indent, the label's own padding and bar, and the closing bar. */
const FURNITURE = 3 + 2 + 1;

function columnsFor(width: number): Column[] {
  const withChars = width >= 92;
  const narrow = width < 76;
  const status = narrow ? 12 : STATUS;
  const tools = narrow ? 4 : TOOLS;
  const tokens = narrow ? 7 : TOKENS;
  const resident = narrow ? 7 : RESIDENT;
  const others = [status, tools, resident, tokens];
  if (withChars) others.push(CHARS);
  const fixed = others.reduce((sum, w) => sum + w + 3, 0) + FURNITURE;
  const label = Math.max(8, Math.min(34, width - fixed));
  return [
    { header: '', width: label, align: 'left' },
    { header: '', width: status, align: 'left' },
    { header: 'tools', width: tools, align: 'right' },
    ...(withChars ? [{ header: 'chars', width: CHARS, align: 'right' as const }] : []),
    { header: 'resident', width: resident, align: 'right' },
    { header: 'loaded', width: tokens, align: 'right' },
  ];
}

function statusLabel(status: MeasuredMcpServer['status']): string {
  switch (status.kind) {
    case 'measured':
      return 'measured';
    case 'cached':
      // Month and day only. The year is the same year in every case that matters, and the column
      // it has to fit in is shared with the server's name.
      return `cached ${status.at.slice(5, 10)}`;
    case 'estimated':
      return 'estimated';
    case 'unmeasured':
      return 'unmeasured';
  }
}

export function renderMeasure(
  config: ResolvedConfig,
  measure: MeasureResult,
  colour: Palette,
  width = screenWidth(),
): string {
  const out: string[] = [];
  const line = (text = ''): void => {
    out.push(text);
  };
  /** Prose, wrapped to the window and kept under its own indent. See `layout.ts`. */
  const say = (
    text: string,
    indent: number,
    paint: (part: string) => string,
    max = 6,
  ): void => {
    for (const part of wrapClamped(text, width - indent, max)) line(' '.repeat(indent) + paint(part));
  };

  line();
  line(`  ${colour.bold('context-tax measure')}  ${colour.dim(config.cwd)}`);
  say(PROVISIONAL_NOTE, 2, colour.yellow);

  line();
  say(
    'resident: what every turn carries while your client defers tool schemas. loaded: with them in.',
    2,
    colour.dim,
  );

  /* ---------------------------------------------------------------------------------------- */

  const columns = columnsFor(width);
  const hasChars = columns.length === 6;
  /** Dashes, never zeroes. The difference between the two is the whole measurement contract. */
  const blanks = (): Cell[] =>
    (hasChars ? [0, 0, 0, 0] : [0, 0, 0]).map(() => ({ text: '-', paint: colour.dim }));

  const notes: string[] = [];
  const serverRows: Section = measure.servers.map((server) => {
    const declared = config.mcpServers.find((entry) => entry.name === server.name);
    const status: Cell = {
      text: statusLabel(server.status),
      paint: server.status.kind === 'unmeasured' ? colour.yellow : colour.dim,
    };
    const numbers: Cell[] =
      server.chars === null
        ? blanks()
        : [
            { text: n(server.toolCount ?? 0) },
            ...(hasChars ? [{ text: n(server.chars), paint: colour.dim }] : []),
            {
              text: server.residentTokens === null ? '?' : n(server.residentTokens),
              paint: colour.bold,
            },
            { text: n(server.tokens ?? 0), paint: colour.dim },
          ];

    // The notes under the table, in the same order as the rows. One row is one line; anything a
    // cell cannot hold is said here rather than folded into the grid.
    if (server.status.kind === 'unmeasured') {
      notes.push(`${server.name}: ${server.status.reason}`);
    } else {
      if (server.status.kind === 'estimated') {
        notes.push(`${server.name}: from the bundled table (${server.status.source}), not your machine`);
      }
      // The prose blob nobody expects. Shown with its share, because a quarter of a server's cost
      // being a paragraph is the cheapest fix on the page and the easiest one to miss.
      if (server.instructionsChars !== null && server.instructionsChars > 0 && server.chars !== null) {
        const share = Math.round((server.instructionsChars / server.chars) * 100);
        const dropped =
          server.instructionsDroppedChars !== null && server.instructionsDroppedChars > 0
            ? `, and ${n(server.instructionsDroppedChars)} more the client truncated away`
            : '';
        notes.push(
          `${server.name}: ${n(server.instructionsChars)} of ${n(server.chars)} characters are the` +
            ` server's instructions blob (${share}%)${dropped}`,
        );
      }
      if (
        declared !== undefined &&
        server.transportUsed !== null &&
        server.transportUsed !== declared.transport
      ) {
        notes.push(`${server.name}: declared ${declared.transport}, answered on ${server.transportUsed}`);
      }
    }

    return [{ text: server.name }, status, ...numbers];
  });

  const group = (label: string, count: string, item: { chars: number; tokens: number }): Cell[] => [
    { text: label, paint: colour.bold },
    { text: count, paint: colour.dim },
    { text: '' },
    ...(hasChars ? [{ text: n(item.chars), paint: colour.dim }] : []),
    { text: n(item.tokens), paint: colour.bold },
    { text: n(item.tokens), paint: colour.dim },
  ];

  const sections: Section[] = [];
  if (serverRows.length > 0) sections.push(serverRows);
  sections.push([
    group('SKILLS', `${n(measure.skills.items)} listed`, measure.skills),
    group('AGENTS', `${n(measure.agents.items)} listed`, measure.agents),
    group('MEMORY', `${n(measure.memory.items)} files`, measure.memory),
    [
      { text: 'COMMANDS', paint: colour.bold },
      { text: 'not costed', paint: colour.dim },
      ...blanks(),
    ],
  ]);
  sections.push([
    [
      { text: 'EVERY TURN', paint: colour.bold },
      { text: '' },
      { text: '' },
      ...(hasChars ? [{ text: '' }] : []),
      { text: n(measure.residentTokens), paint: colour.bold },
      { text: n(measure.measuredTokens), paint: colour.dim },
    ],
  ]);

  line();
  const header: Cell[] = [
    { text: 'MCP SERVERS', paint: colour.bold },
    ...columns.slice(1).map((column) => ({ text: column.header, paint: colour.dim })),
  ];
  for (const text of renderTable(columns, header, sections, colour, 2)) line(text);

  for (const note of notes) {
    for (const part of hangingText(note, width, 4, 2)) line(colour.dim(part));
  }

  say(
    'COMMANDS: not costed, because whether a command reaches the prefix is not settled.',
    4,
    colour.dim,
  );
  say(
    `the deferred schemas add ${n(measure.measuredTokens - measure.residentTokens)} more, paid when` +
      ' something loads them, or on every turn if your client does not defer',
    4,
    colour.dim,
  );
  if (measure.unsplit > 0) {
    say(
      `${n(measure.unsplit)} server${measure.unsplit === 1 ? '' : 's'} could not be itemised, so ${
        measure.unsplit === 1 ? 'it is' : 'they are'
      } missing from the resident total`,
      4,
      colour.yellow,
    );
  }
  if (measure.unmeasured > 0) {
    say(
      `${n(measure.unmeasured)} server${measure.unmeasured === 1 ? '' : 's'} could not be measured and ${
        measure.unmeasured === 1 ? 'is' : 'are'
      } not in that total`,
      4,
      colour.yellow,
    );
  }

  line();
  line(`  ${colour.bold('WHAT THIS RUN TOUCHED')}`);
  say(
    measure.spawned.length === 0 ? 'started nothing' : `started: ${measure.spawned.join(', ')}`,
    4,
    colour.dim,
  );
  say(
    measure.contacted.length === 0
      ? 'contacted nothing over the network'
      : `contacted: ${measure.contacted.join(', ')}`,
    4,
    colour.dim,
  );
  say(
    'Only servers already in your config, with your own credentials, asked only for tools/list.',
    4,
    colour.dim,
  );

  line();
  return out.join('\n');
}
