#!/usr/bin/env node
/**
 * The CLI.
 *
 *   `context-tax`            cost joined against usage, with a verdict per row   (the product)
 *   `context-tax fix`        execute the recommendations, after showing the diff
 *   `context-tax config`     what is loaded here right now
 *   `context-tax measure`    what it weighs, per server, per skill, per file
 *   `context-tax evidence`   what your sessions actually used (development view)
 *
 * No dollar figure is printed. The tokenizer is calibrated now (§15, within 4%), but a price is
 * the one input that cannot be read off this machine, and a number that has to be supplied is not
 * a number the tool should invent. Tokens times turns already changes behaviour.
 *
 * 🚨 `fix` is the only command that writes, and the confirmation prompt lives **here** rather than
 * in `fix/` on purpose: a function that both asks and writes cannot be tested without a terminal,
 * and the part that must never be bypassed is the part that must be easiest to read.
 */

import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { isAbsolute, relative, resolve as resolvePath } from 'node:path';

import { HELP, parseArgs } from './args.js';
import { scanEvidence } from './evidence/index.js';
import { applyFixes, planFixes } from './fix/index.js';
import { buildLedger } from './ledger/index.js';
import { measureContext } from './measure/index.js';
import { colourEnabled, palette } from './render/color.js';
import { renderConfig } from './render/config.js';
import { renderApplied, renderPlan } from './render/fix.js';
import { hangingText, screenWidth } from './render/layout.js';
import { renderLedger } from './render/ledger.js';
import { renderMeasure } from './render/measure.js';
import { resolveConfig } from './resolve/index.js';

import type { Args } from './args.js';
import type { Ledger } from './ledger/types.js';

/**
 * The version, read from the manifest at runtime.
 *
 * `../package.json` resolves the same way from `dist/index.js` and from `src/index.ts` under tsx,
 * and npm always ships the manifest. Importing it instead would drag a JSON file into `rootDir`
 * and change the shape of `dist/`.
 */
async function version(): Promise<string> {
  try {
    const text = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const value = (parsed as { version: unknown }).version;
      if (typeof value === 'string') return value;
    }
  } catch {
    /* falls through: a missing manifest is not a reason to fail a --version */
  }
  return 'unknown';
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Either direction: the flag pointing up at the repo root, or down at one of its packages. */
function sameTree(target: string): boolean {
  const here = resolvePath(process.cwd());
  return isWithin(here, target) || isWithin(target, here);
}


async function config(args: Args): Promise<void> {
  // 🔒 `launch` holds command lines, environment values and bearer tokens. It is destructured away
  // here and never reaches a renderer or `--json`, which is the point of it being a separate field.
  const { config: resolved } = await resolveConfig({ cwd: args.cwd });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderConfig(resolved, palette(colourEnabled(args.color)))}\n`);
}

/**
 * The default command: cost joined against usage, with a verdict per row.
 *
 * It runs all three passes. The evidence scan is scoped to this directory tree, which is what
 * keeps the default command in the seconds rather than the minute a whole-corpus pass takes.
 */
async function buildAll(args: Args): Promise<Ledger> {
  const resolvedResult = await resolveConfig({ cwd: args.cwd });
  const root = resolvedResult.config.repoRoot ?? resolvedResult.config.cwd;
  const [measured, evidence] = await Promise.all([
    measureContext(resolvedResult, {
      spawn: args.spawn,
      refresh: args.refresh,
      timeoutMs: args.timeoutMs,
      trustProjectServers: args.cwd === undefined || sameTree(resolvePath(args.cwd)),
    }),
    scanEvidence({ cwd: root }),
  ]);
  return buildLedger(resolvedResult, measured, evidence, { window: args.window });
}

async function ledger(args: Args): Promise<void> {
  const built = await buildAll(args);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(built, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderLedger(built, palette(colourEnabled(args.color)))}\n`);
  }
  // 🚨 The measurement contract, as an exit code: rows summing past the billed total means the
  // estimator is wrong, and a wrong ledger must not exit 0 into somebody's CI.
  if (built.reconciliation.overAttributed) process.exitCode = 1;
}

/**
 * `context-tax fix` — execute the ledger's recommendations.
 *
 * The order is fixed and none of it is optional: build the same ledger the default command prints,
 * plan the edits without touching disk, show every changed line, then ask. `--dry-run` stops before
 * the question; `--yes` answers it; **nothing else writes**.
 *
 * 🚨 A non-interactive run without `--yes` refuses rather than assuming consent. A CLI that writes
 * to a config file because it could not find a terminal to ask is a CLI that writes to config files
 * in CI.
 */
async function fix(args: Args): Promise<void> {
  const colour = palette(colourEnabled(args.color));
  const built = await buildAll(args);
  const plan = await planFixes(built.actions);

  if (args.json) {
    // 🔒 The plan without the file bodies. `before` and `after` are whole settings files, and a
    // settings file can carry an `env` block with an API key in it — printing them to a stream
    // somebody will redirect into `plan.json` and commit is a leak this tool would have caused.
    // The human path shows changed hunks with three lines of context, which is a different risk.
    // What a script actually needs is what would change and what it saves.
    process.stdout.write(
      `${JSON.stringify(
        {
          ...plan,
          edits: plan.edits.map((edit) => ({
            path: edit.path,
            created: edit.before === null,
            actions: edit.actions,
          })),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(`${renderPlan(plan, colour)}\n`);
  if (plan.problems.length > 0) process.exitCode = 1;
  if (plan.edits.length === 0) return;

  if (args.dryRun) {
    process.stdout.write(`  ${colour.dim('--dry-run: nothing was written.')}\n\n`);
    return;
  }

  if (!args.yes) {
    if (process.stdin.isTTY !== true) {
      process.stdout.write(
        `  ${colour.yellow('Not a terminal, so there is nobody to ask. Re-run with --yes to write these,')}\n` +
          `  ${colour.yellow('or --dry-run to see them without the question.')}\n\n`,
      );
      process.exitCode = 1;
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`  Write ${plan.edits.length === 1 ? 'this file' : 'these files'}? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      process.stdout.write(`\n  ${colour.dim('Nothing written.')}\n\n`);
      return;
    }
    process.stdout.write('\n');
  }

  const applied = await applyFixes(plan);
  process.stdout.write(`${renderApplied(applied, colour)}\n`);
}

async function measure(args: Args): Promise<void> {
  const resolved = await resolveConfig({ cwd: args.cwd });
  const result = await measureContext(resolved, {
    spawn: args.spawn,
    refresh: args.refresh,
    timeoutMs: args.timeoutMs,
    // 🚨 A project `.mcp.json` we are not standing in may not be started: running one executes
    // code from a directory the user only pointed at. Standing in the tree is consent, a flag is
    // not. Anywhere inside the tree counts, because running this from `packages/x` is still
    // running it in your own repo.
    trustProjectServers: args.cwd === undefined || sameTree(resolvePath(args.cwd)),
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ config: resolved.config, measure: result }, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${renderMeasure(resolved.config, result, palette(colourEnabled(args.color)))}\n`,
  );
}

async function evidence(args: Args): Promise<void> {
  const started = Date.now();
  const scanned = await scanEvidence({ cwd: args.cwd });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(scanned, null, 2)}\n`);
    return;
  }

  const n = (value: number): string => value.toLocaleString('en-US');
  // Every line here is a joined list, and a joined list is exactly the shape that ran off the
  // right-hand edge of the window and wrapped back to column 0.
  const width = screenWidth();
  const say = (text: string, indent: number, hang = 2): void => {
    for (const part of hangingText(text, width, indent, hang)) console.log(part);
  };
  const turns = scanned.projects.reduce((sum, project) => sum + project.turns, 0);
  // Subagent transcripts are billed work but not sessions; counting them here would inflate every
  // per-session figure a reader derives from this line.
  const sessions = scanned.sessions.filter((session) => session.kind === 'session').length;
  const subagents = scanned.sessions.length - sessions;
  const context = scanned.projects.reduce((sum, project) => sum + project.contextTokens, 0);

  console.log('');
  say(
    `scanned ${n(scanned.scannedFiles)} files in ${elapsed}s · ` +
      `${n(sessions)} sessions (+${n(subagents)} subagent transcripts) · ${n(turns)} turns · ` +
      `${n(context)} context tokens · ${n(scanned.malformedLines)} malformed lines`,
    2,
  );
  console.log('');

  for (const project of scanned.projects.slice(0, args.top)) {
    const cold = project.coldStart;
    console.log(`  ${project.cwd}`);
    say(
      `${n(project.sessions)} sessions · ${n(project.turns)} turns ` +
        `(${n(project.sidechainTurns)} sidechain) · cold start median ` +
        `${cold ? n(Math.round(cold.median)) : '-'}`,
      4,
    );
    const servers = Object.entries(project.mcpServers).sort((a, b) => b[1].calls - a[1].calls);
    if (servers.length > 0) {
      say(
        `mcp: ${servers.map(([name, use]) => `${name} ${n(use.calls)}/${n(use.sessions)}s`).join('  ')}`,
        4,
        5,
      );
    }
    const skills = Object.entries(project.skills).sort((a, b) => b[1].model - a[1].model);
    if (skills.length > 0) {
      say(
        `skills(model): ${skills
          .slice(0, 6)
          .map(([name, use]) => `${name} ${use.model}`)
          .join('  ')}`,
        4,
        5,
      );
    }
    const slash = Object.entries(project.slashCommands).sort((a, b) => b[1] - a[1]);
    if (slash.length > 0) {
      say(
        `slash(user): ${slash
          .slice(0, 6)
          .map(([name, count]) => `/${name} ${count}`)
          .join('  ')}`,
        4,
        5,
      );
    }
    console.log('');
  }
}

const args = parseArgs(process.argv.slice(2));

/**
 * 🚨 `--cwd` is the one flag whose value the parser cannot judge, because judging it means
 * touching the disk and the parser is deliberately pure. Left unchecked it is the worst kind of
 * bad input: a mistyped path resolves to *nothing*, so every project-scoped server and skill comes
 * back with zero calls against it, and the tool reports a directory that does not exist as a place
 * where ten skills are going unused. `fix` would then offer to write that verdict into
 * `<typo>/.claude/settings.local.json`, creating the tree on the way. Every other bad flag costs
 * you an exit code; this one used to cost you a confident wrong answer.
 */
if (args.cwd !== undefined) {
  const what = await stat(resolvePath(args.cwd)).catch(() => null);
  if (what === null) args.usageErrors.push(`--cwd ${JSON.stringify(args.cwd)} does not exist.`);
  else if (!what.isDirectory()) args.usageErrors.push(`--cwd ${JSON.stringify(args.cwd)} is not a directory.`);
}

/**
 * 🚨 Nothing runs until the command line is known to be good, and a bad one costs an exit code
 * rather than a shrug. Every command below either starts MCP servers or reads a 2 GB transcript
 * corpus, so "carry on with the defaults and hope" is not a cheap mistake here.
 *
 * `help` is exempt: somebody asking what the flags are is better served by the list than by being
 * told their flag was wrong.
 */
if (args.command === 'help') {
  process.stdout.write(`${HELP}\n`);
} else if (args.usageErrors.length > 0) {
  for (const problem of args.usageErrors) process.stderr.write(`\n  ${problem}\n`);
  process.stderr.write(`\n  context-tax help lists every command and flag.\n\n`);
  process.exitCode = 1;
} else {
  switch (args.command) {
    case 'ledger':
      await ledger(args);
      break;
    case 'version':
      process.stdout.write(`${await version()}\n`);
      break;
    case 'fix':
      await fix(args);
      break;
    case 'config':
      await config(args);
      break;
    case 'measure':
      await measure(args);
      break;
    case 'evidence':
      await evidence(args);
      break;
    default:
      // Naming it matters: printing the help with no reason attached reads like the tool simply
      // decided not to run.
      process.stderr.write(`\n  unknown command ${JSON.stringify(args.command)}.\n`);
      process.stdout.write(`${HELP}\n`);
      process.exitCode = 1;
  }
}
