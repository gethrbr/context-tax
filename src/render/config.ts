/**
 * `context-tax config` — what is loaded in this directory right now.
 *
 * This screen ships before any cost number exists, because it answers a question nothing else
 * does: *what is actually in my context in this repo?* Today the only way to find out is to start
 * a session and run `/context`, which reports the session you are already paying for and cannot
 * tell you what a **different** directory would load.
 *
 * 🔑 The block that matters most is the last one. A config resolver that printed a confident list
 * would be claiming to have seen the whole context, and it has not: account-level connectors are
 * attached to the login, not the checkout, and appear in no file on this machine. Saying so is the
 * difference between a tool you can check and a tool you have to trust.
 */

import type { Palette } from './color.js';
import { hangingText, screenWidth, shortPath, wrapClamped } from './layout.js';
import type { Cell, Column, Section } from './table.js';
import { renderTable } from './table.js';
import type { ConfiguredSince, ResolvedConfig, ResolvedMcpServer } from '../resolve/types.js';

const n = (value: number): string => value.toLocaleString('en-US');

function since(value: ConfiguredSince): string {
  if (!value.known) return 'unknown';
  return value.iso.slice(0, 10);
}

function origin(server: ResolvedMcpServer): string {
  switch (server.scope) {
    case 'project-mcp-json':
      return '.mcp.json';
    case 'user':
      return '~/.claude.json';
    case 'claude-json-project':
      return '~/.claude.json (project)';
    case 'plugin':
      // The marketplace half is noise in a column this narrow; the plugin name is the identifier.
      return `plugin ${(server.plugin ?? '?').split('@')[0]}`;
  }
}

/** Pad to `width`, and ellipsise past it — a long value must not shunt every later column right. */
function pad(text: string, width: number): string {
  if (text.length > width) return `${text.slice(0, width - 1)}\u2026`;
  return text + ' '.repeat(width - text.length);
}

export function renderConfig(
  config: ResolvedConfig,
  colour: Palette,
  width = screenWidth(),
): string {
  const out: string[] = [];
  const line = (text = ''): void => {
    out.push(text);
  };
  /** Prose and joined lists, wrapped to the window rather than to a guess about it. */
  const say = (
    text: string,
    indent: number,
    paint: (part: string) => string = colour.dim,
    max = 8,
  ): void => {
    for (const part of wrapClamped(text, width - indent, max)) line(' '.repeat(indent) + paint(part));
  };

  line();
  line(`  ${colour.bold('context-tax config')}  ${colour.dim(shortPath(config.cwd, width - 22))}`);
  if (config.repoRoot === null) {
    // Not fatal, but it changes two answers, so it is said rather than left to be inferred from a
    // column of `added: unknown`.
    line(`  ${colour.yellow('not a git repository')}`);
    say('config anchors on the working directory, and no line item can be dated', 4);
  }

  /* ---------------------------------------------------------------------------------------- */

  const loaded = config.mcpServers.filter((server) => server.enabled);
  const off = config.mcpServers.filter((server) => !server.enabled);
  line();
  line(
    `  ${colour.bold('MCP SERVERS')}  ${colour.dim(`${n(loaded.length)} loaded${off.length > 0 ? ` · ${n(off.length)} configured but off` : ''}`)}`,
  );
  if (config.mcpServers.length === 0) {
    line(`    ${colour.dim('none')}`);
  } else {
    // Same grid as the ledger and the measure screen: one server is one line, and anything that
    // does not fit a cell goes underneath as a note rather than wrapping the row in half.
    const notes: string[] = [];
    const columns: Column[] = [
      // The name column takes whatever the fixed ones leave: 6 + 23 + 8 + 13 for their widths,
      // padding and bars, plus 3 for the name's own, plus the indent and the closing bar.
      { header: '', width: 3, align: 'left' },
      { header: 'server', width: Math.max(10, Math.min(28, width - 56)), align: 'left' },
      { header: 'declared in', width: 20, align: 'left' },
      { header: 'via', width: 5, align: 'left' },
      { header: 'added', width: 10, align: 'left' },
    ];
    const rows: Section = config.mcpServers.map((server) => {
      if (!server.enabled) notes.push(`${server.name}: ${server.enabledReason}`);
      // Env var and header NAMES are printed; their values never leave the config files.
      if (server.envKeys.length > 0) notes.push(`${server.name}: env ${server.envKeys.join(', ')}`);
      return [
        { text: server.enabled ? 'on' : 'off', paint: server.enabled ? colour.green : colour.dim },
        { text: server.name },
        { text: origin(server), paint: colour.dim },
        { text: server.transport, paint: colour.dim },
        { text: since(server.configuredSince), paint: colour.dim },
      ];
    });
    const header: Cell[] = columns.map((column) => ({ text: column.header, paint: colour.dim }));
    for (const text of renderTable(columns, header, [rows], colour, 2)) line(text);
    for (const note of notes) {
      for (const part of hangingText(note, width, 4, 2)) line(colour.dim(part));
    }
  }

  /* ---------------------------------------------------------------------------------------- */

  const skills = config.skills.filter((skill) => skill.shadowedBy === null);
  const shadowed = config.skills.length - skills.length;
  const silenced = skills.filter((skill) => skill.override === 'off' || skill.override === 'user-invocable-only');
  line();
  line(
    `  ${colour.bold('SKILLS')}  ${colour.dim(
      `${n(skills.length)} listed to the model` +
        (shadowed > 0 ? ` · ${n(shadowed)} shadowed by a project copy` : '') +
        (silenced.length > 0 ? ` · ${n(silenced.length)} hidden by skillOverrides` : ''),
    )}`,
  );
  const listingChars = skills.reduce((sum, skill) => sum + skill.listingChars, 0);
  say(
    `${n(listingChars)} characters of name + description. The bodies load on use and are not counted.`,
    4,
  );
  for (const scope of ['user', 'project', 'plugin'] as const) {
    const inScope = skills.filter((skill) => skill.scope === scope);
    if (inScope.length === 0) continue;
    // 🔑 Plugin skills are addressed `plugin:skill` and two enabled plugins can ship the same
    // name — this machine has `frontend-design` from two marketplaces. Rendering the bare name
    // twice reads as a bug in the tool rather than as the duplication it actually is.
    const names = inScope.map((skill) =>
      skill.plugin === null ? skill.name : `${skill.plugin.split('@')[0]}:${skill.name}`,
    );
    // A scope's names are one long joined list, so they hang under the scope label rather than
    // wrapping back to the margin and reading as a new scope.
    hangingText(`${pad(scope, 8)} ${names.join(', ')}`, width, 4, 9).forEach((part, at) =>
      line(at === 0 ? part : colour.dim(part)),
    );
  }

  /* ---------------------------------------------------------------------------------------- */

  const agents = config.agents.filter((agent) => agent.shadowedBy === null);
  line();
  line(`  ${colour.bold('AGENTS')}  ${colour.dim(`${n(agents.length)} listed`)}`);
  say(
    `${n(agents.reduce((sum, agent) => sum + agent.listingChars, 0))} characters of name + description + tool grant.`,
    4,
  );

  line();
  line(`  ${colour.bold('COMMANDS')}  ${colour.dim(`${n(config.commands.length)} found`)}`);
  say(
    'Not costed. Whether a command reaches the system prompt is not settled, and the measurement' +
      ' contract labels an unknown rather than estimating it.',
    4,
  );

  /* ---------------------------------------------------------------------------------------- */

  const always = config.memory.filter((file) => file.alwaysLoaded);
  const onDemand = config.memory.filter((file) => !file.alwaysLoaded);
  line();
  line(
    `  ${colour.bold('MEMORY')}  ${colour.dim(`${n(always.length)} file${always.length === 1 ? '' : 's'} on every turn · ${n(always.reduce((sum, file) => sum + file.bytes, 0))} bytes`)}`,
  );
  for (const file of always) {
    line(`    ${pad(n(file.bytes), 8)} ${colour.dim(shortPath(file.path, width - 13))}`);
  }
  if (onDemand.length > 0) {
    say(
      `+ ${n(onDemand.length)} nested CLAUDE.md that ${onDemand.length === 1 ? 'loads' : 'load'} only when a file under ${onDemand.length === 1 ? 'it is' : 'them are'} touched`,
      4,
    );
  }

  /* ---------------------------------------------------------------------------------------- */

  line();
  line(`  ${colour.bold('NOT VISIBLE FROM LOCAL CONFIG')}`);
  say(
    'MCP connectors attached to your claude.ai account appear in no file on this machine, and this' +
      ' command cannot see them. They are real context and can be large: one such connector carries' +
      ' ~70 tool schemas. Run /context in a session to see them, and read this list as local' +
      ' config only.',
    4,
  );

  /* ---------------------------------------------------------------------------------------- */

  if (config.problems.length > 0) {
    line();
    line(`  ${colour.bold('PROBLEMS')}  ${colour.dim(`${n(config.problems.length)}`)}`);
    for (const problem of config.problems) {
      say(problem.message, 4, colour.yellow);
      say(shortPath(problem.path, width - 6), 6, colour.dim, 2);
    }
  }

  line();
  return out.join('\n');
}
