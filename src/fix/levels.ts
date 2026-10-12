/**
 * How much `fix` takes away, and where each level draws its line.
 *
 * 🔑 The default level writes only what you do not use. Everything above it takes away something
 * you have used, now and then, so how far to go is the person's call and never this tool's: a
 * terminal is asked, and a run that cannot ask gets `safe` unless `--level` says otherwise.
 *
 * The lines live here, once, because three places have to agree on them: the ledger that sorts each
 * tool and plugin into a level, the parser that accepts `--level`, and the menu that describes them.
 */

import type { FixLevel, Ledger, StrongerLevel } from '../ledger/types.js';
import { actionKey, isFileAction } from './types.js';
import type { FixAction, FixPlan } from './types.js';

/** Mildest first. The order is the order the menu offers them in. */
export const FIX_LEVELS: readonly FixLevel[] = ['safe', 'lean', 'max'];

/**
 * The share of sessions under which a tool or plugin you have used is offered at each stronger
 * level. A use at or above the `max` line is never offered.
 *
 * Under one session in twenty, a tool is mostly weight: measured on a real machine, one was 13,845
 * tokens of a 72,000-token first request and had been used in 10 of the 282 sessions that carried it.
 */
export const LEVEL_LINES: readonly { level: StrongerLevel; share: number; words: string }[] = [
  { level: 'lean', share: 1 / 20, words: 'under 1 session in 20' },
  { level: 'max', share: 1 / 5, words: 'under 1 session in 5' },
];

/** What each level switches off, on top of the one before it, said the way the menu says it. */
export const LEVEL_MEANS: Record<FixLevel, string> = {
  safe: 'what you do not use',
  lean: `also what you use in ${LEVEL_LINES[0].words}`,
  max: `also what you use in ${LEVEL_LINES[1].words}`,
};

/** The first stronger level whose line `uses` in `over` sessions falls under; `null` when used more. */
export function levelFor(uses: number, over: number): (typeof LEVEL_LINES)[number] | null {
  return LEVEL_LINES.find((line) => uses / over < line.share) ?? null;
}

/** Everything `fix` would do at `level`: the default plan, plus each stronger level up to it. */
export function actionsAt(ledger: Pick<Ledger, 'actions' | 'levelActions'>, level: FixLevel): FixAction[] {
  return [
    ...ledger.actions,
    ...LEVEL_LINES.filter((line) => FIX_LEVELS.indexOf(line.level) <= FIX_LEVELS.indexOf(level)).flatMap(
      (line) => ledger.levelActions[line.level],
    ),
  ];
}

/** The short name a person knows each change by: `Artifact`, `posthog`, `reviewer`. */
export function changeName(action: FixAction): string {
  switch (action.kind) {
    case 'deny':
      return /^Agent\((.+)\)$/.exec(action.rule)?.[1] ?? action.rule;
    case 'disable-plugin':
      return action.plugin.split('@')[0];
    case 'disable-mcpjson-server':
      return action.server;
    case 'skill-override':
      return action.skill;
    case 'listing-budget':
      return 'the skill listing budget';
    case 'manual':
      return action.command ?? 'a manual step';
  }
}

/** The names of `actions`, heaviest first: the one worth reading about is the one to see first. */
export function namesByWeight(actions: FixAction[]): string[] {
  const saves = (action: FixAction): number => (isFileAction(action) ? (action.saves ?? 0) : 0);
  return [...actions].sort((a, b) => saves(b) - saves(a)).map(changeName);
}

/** One level as the menu offers it: what picking it would do in all, and what it adds by name. */
export interface LevelOffer {
  level: FixLevel;
  /** Settings changes the level would write, counting the levels below it. */
  changes: number;
  /** Tokens per turn those changes recover. */
  saves: number;
  /** What this level writes that the one before it does not, by the name a person knows each by. */
  adds: string[];
}

/**
 * The levels worth offering, from each level's plan. Named by what is left to write, so a change an
 * earlier fix already made is not offered again, and a stronger level with nothing left is dropped:
 * it is not a choice, and listing it would read as one. `safe` always stays, as the default.
 */
export function levelOffers(plans: Record<FixLevel, FixPlan>): LevelOffer[] {
  const offers: LevelOffer[] = [];
  let below = new Set<string>();
  for (const level of FIX_LEVELS) {
    const writes = plans[level].edits.flatMap((edit) => edit.actions);
    const fresh = writes.filter((action) => !below.has(actionKey(action)));
    below = new Set(writes.map(actionKey));
    if (level !== 'safe' && fresh.length === 0) continue;
    offers.push({ level, changes: writes.length, saves: plans[level].saves, adds: namesByWeight(fresh) });
  }
  return offers;
}

/**
 * 🚨 Whether `fix` asks which level. Only a person at a terminal who has not already said: a run
 * with `--level` has picked, `--yes` and `--dry-run` are runs that ask nothing, `--json` is read by
 * a script, and with one level on offer there is nothing to pick between.
 */
export function asksForLevel(
  args: { level?: FixLevel; json: boolean; dryRun: boolean; yes: boolean },
  terminal: boolean,
  offers: number,
): boolean {
  return args.level === undefined && !args.json && !args.dryRun && !args.yes && terminal && offers > 1;
}
