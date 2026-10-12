/**
 * What `fix` will do, shown before it does it.
 *
 * The diff is the point. Everything above it is a summary, and a summary is a second description
 * of the change that can drift from the change — so the thing the reader confirms is the literal
 * lines that will land in the file, not a sentence about them.
 *
 * 🔑 The `HANDED BACK TO YOU` block is not a shortfall to apologise for. It is where the tool draws
 * its own boundary: `~/.claude.json` holds live credentials, so this tool neither rewrites it nor
 * copies it, and the servers declared there leave as a command you run. A tool that quietly reached
 * into that file would be a worse tool that looked more capable.
 */

import type { AppliedFile, FixPlan, ManualAction, SettingsAction } from '../fix/types.js';
import { unifiedDiff } from '../fix/diff.js';
import { FIX_LEVELS, LEVEL_MEANS } from '../fix/levels.js';
import type { LevelOffer } from '../fix/levels.js';
import type { FixLevel } from '../ledger/types.js';
import type { Palette } from './color.js';
import { screenWidth, shortPath, wrapClamped, wrapText } from './layout.js';

const n = (value: number): string => value.toLocaleString('en-US');

function actionLine(action: SettingsAction): string {
  switch (action.kind) {
    case 'disable-mcpjson-server':
      return `disable the ${action.server} MCP server`;
    case 'disable-plugin':
      return `switch off the ${action.plugin} plugin`;
    case 'skill-override':
      return `set the ${action.skill} skill to ${action.value}`;
    case 'deny': {
      const agent = /^Agent\((.+)\)$/.exec(action.rule);
      return agent === null
        ? `switch off Claude Code's ${action.rule} tool`
        : `switch off the ${agent[1]} agent`;
    }
    case 'listing-budget':
      return `raise the skill listing budget to ${action.fraction} of the window`;
  }
}

/**
 * ⚠️ Diff lines are never wrapped, shortened or ellipsised, however wide they are. They are the
 * literal bytes that will land in the file, and a diff you have edited for the screen is no longer
 * the thing the reader is confirming.
 */
function renderDiff(before: string | null, after: string, colour: Palette): string[] {
  const out: string[] = [];
  if (before === null) {
    // A file that does not exist yet has no hunks to show, and printing a diff against nothing
    // buries a short new file in `+` markers. The whole thing is the change.
    for (const text of after.replace(/\n$/, '').split('\n')) out.push(`      ${colour.green(`+ ${text}`)}`);
    return out;
  }
  for (const hunk of unifiedDiff(before, after)) {
    out.push(
      `      ${colour.cyan(
        `@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`,
      )}`,
    );
    for (const line of hunk.lines) {
      const text = `${line.kind} ${line.text}`;
      if (line.kind === '+') out.push(`      ${colour.green(text)}`);
      else if (line.kind === '-') out.push(`      ${colour.red(text)}`);
      else out.push(`      ${colour.dim(text)}`);
    }
  }
  return out;
}

function renderManual(manual: ManualAction[], colour: Palette, width: number): string[] {
  const out: string[] = [];
  const say = (text: string, indent: number, paint: (part: string) => string): void => {
    for (const part of wrapClamped(text, width - indent, 6)) out.push(' '.repeat(indent) + paint(part));
  };
  out.push('');
  out.push(`  ${colour.bold('HANDED BACK TO YOU')}`);
  say(
    'These do not live in a settings file this tool will write. Servers declared in' +
      ' ~/.claude.json sit beside live API keys, so context-tax neither edits that file nor backs' +
      ' it up: a backup would be a second copy of every credential.',
    4,
    colour.dim,
  );
  for (const action of manual) {
    out.push('');
    say(action.why, 4, colour.dim);
    // The command is meant to be copied, so it is never wrapped and never shortened.
    if (action.command !== null) out.push(`      ${colour.cyan(action.command)}`);
  }
  return out;
}

export function renderPlan(plan: FixPlan, colour: Palette, width = screenWidth()): string {
  const out: string[] = [];
  const line = (text = ''): void => {
    out.push(text);
  };
  const say = (text: string, indent: number, paint: (part: string) => string): void => {
    for (const part of wrapClamped(text, width - indent, 6)) line(' '.repeat(indent) + paint(part));
  };

  line();
  if (plan.edits.length === 0 && plan.manual.length === 0 && plan.problems.length === 0) {
    line(
      `  ${colour.bold('Nothing to change.')} ${colour.dim(
        plan.alreadyApplied.length > 0
          ? `${plan.alreadyApplied.length} recommendation${plan.alreadyApplied.length === 1 ? ' is' : 's are'} already in your settings.`
          : 'No finding here has an automatic lever.',
      )}`,
    );
    line();
    return out.join('\n');
  }

  if (plan.edits.length > 0) {
    line(`  ${colour.bold('WILL CHANGE')}`);
    for (const edit of plan.edits) {
      line();
      line(
        `    ${colour.bold(shortPath(edit.path, width - 16))}${edit.before === null ? colour.dim('  (new file)') : ''}`,
      );
      for (const action of edit.actions) {
        say(actionLine(action), 6, colour.yellow);
        say(action.why, 8, colour.dim);
      }
      line();
      for (const text of renderDiff(edit.before, edit.after, colour)) line(text);
    }
  }

  if (plan.manual.length > 0) for (const text of renderManual(plan.manual, colour, width)) line(text);

  if (plan.alreadyApplied.length > 0) {
    line();
    line(
      `  ${colour.dim(
        `${plan.alreadyApplied.length} recommendation${plan.alreadyApplied.length === 1 ? '' : 's'} already applied, left alone.`,
      )}`,
    );
  }

  if (plan.problems.length > 0) {
    line();
    line(`  ${colour.bold('NOT TOUCHED')}`);
    for (const problem of plan.problems) {
      line(`    ${colour.red(shortPath(problem.path, width - 4))}`);
      say(problem.message, 6, colour.dim);
    }
  }

  if (plan.saves > 0) {
    line();
    line(
      `  ${colour.bold(`${n(plan.saves)} tokens per turn`)} ${colour.dim('recovered by the changes above.')}`,
    );
  }
  if (plan.adds > 0) {
    line();
    line(
      // Short enough to stay on one line at 80 columns: the screen above it is a diff, and a
      // sentence that wraps under a diff reads as part of it.
      `  ${colour.bold(`${n(plan.adds)} tokens per turn`)} ${colour.dim(
        'added: the cost of sending every description.',
      )}`,
    );
  }

  line();
  return out.join('\n');
}

export function renderApplied(
  applied: AppliedFile[],
  colour: Palette,
  width = screenWidth(),
): string {
  const out: string[] = [`  ${colour.green('Written.')}`];
  for (const file of applied) {
    out.push(`    ${shortPath(file.path, width - 15)}${file.created ? colour.dim('  (created)') : ''}`);
    if (file.backup !== null) {
      out.push(`      ${colour.dim(`previous contents: ${shortPath(file.backup, width - 25)}`)}`);
    }
  }
  out.push('');
  // A first `fix` usually creates the settings file it writes to, and there is no backup of a
  // file that did not exist. Telling that reader to copy the backup back is an instruction they
  // cannot follow, on the one screen in the tool that has just changed their machine.
  const overwritten = applied.some((file) => file.backup !== null);
  out.push(
    `  ${colour.dim(
      overwritten
        ? 'Restore any of them by copying the backup back over the file.'
        : 'Nothing was overwritten: none of these files existed before, so undoing this is deleting them.',
    )}`,
  );
  return `${out.join('\n')}\n`;
}

/**
 * Names on at most two lines, the rest counted. Ten agents spelled out would push the next level
 * off the screen the person is choosing from.
 */
function nameLines(names: string[], width: number): string[] {
  if (names.length === 0) return [];
  for (let kept = names.length; kept > 0; kept -= 1) {
    const rest = names.length - kept;
    const text = `+ ${names.slice(0, kept).join(', ')}${rest === 0 ? '' : `, and ${rest} more`}`;
    const lines = wrapText(text, width);
    if (lines.length <= 2) return lines;
  }
  return [`+ ${names.length} changes`];
}

/**
 * The levels `fix` can work at. As a numbered menu for a terminal to pick from; with `asFlags`, the
 * levels above the one that ran, as the flags that would run them, for a run that did not ask.
 *
 * 🔑 Each row's number is everything that level would recover, not what it adds, because the
 * question being answered is "what do I get if I pick this one".
 */
export function renderLevels(
  offers: LevelOffer[],
  colour: Palette,
  options: { asFlags: boolean; above?: FixLevel },
  width = screenWidth(),
): string {
  const shown = options.above === undefined
    ? offers
    : offers.filter((offer) => FIX_LEVELS.indexOf(offer.level) > FIX_LEVELS.indexOf(options.above ?? 'safe'));
  const label = (offer: LevelOffer, index: number): string =>
    options.asFlags ? `--level ${offer.level}` : `${index + 1}  ${offer.level}`;
  const labelWidth = Math.max(...shown.map((offer, index) => label(offer, index).length));
  const amounts = shown.map((offer) => (offer.changes === 0 ? 'no change' : `${n(offer.saves)} tokens`));
  const amountWidth = Math.max(...amounts.map((amount) => amount.length));
  // Under the words, not the number: the names say what the words mean on this machine.
  const indent = 4 + labelWidth + 2 + amountWidth + 2;

  const out: string[] = [''];
  out.push(
    options.asFlags
      ? `  ${colour.bold('STRONGER LEVELS')} ${colour.dim('each takes away something you have used')}`
      : `  ${colour.bold('HOW MUCH TO SWITCH OFF')}`,
  );
  out.push('');
  shown.forEach((offer, index) => {
    out.push(
      `    ${colour.bold(label(offer, index).padEnd(labelWidth))}  ${amounts[index].padStart(amountWidth)}  ` +
        colour.dim(LEVEL_MEANS[offer.level]),
    );
    // A wrapped line hangs under the first name, so the `+` marks where each level's list starts.
    nameLines(offer.adds, width - indent - 2).forEach((text, line) => {
      out.push(' '.repeat(line === 0 ? indent : indent + 2) + colour.yellow(text));
    });
  });
  out.push('');
  if (!options.asFlags) out.push(`  ${colour.dim('Every change is shown, with what stops working, before anything is written.')}`, '');
  return out.join('\n');
}
