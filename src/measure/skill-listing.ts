/**
 * What the skill listing costs, modelled the way Claude Code packs it.
 *
 * 🚨 **A skill's description on disk is not what the model is sent.** Summing `name + description`
 * over every skill was this tool's largest number and its most wrong one: on a config with a big
 * plugin it came out several times what an on/off run of that plugin was actually billed. The client
 * caps the listing, so past the cap a description costs nothing because it is not there.
 *
 * The packing, read from Claude Code 2.1 and reproduced here step for step:
 *
 *  1. Each line is `- name: text`. `text` is the description, joined to `when_to_use` with ` - `,
 *     and cut to `skillListingMaxDescChars` (1,536) with an ellipsis.
 *  2. The budget is `contextWindow x 4 x skillListingBudgetFraction` characters: 1% of the window,
 *     so 8,000 characters at 200K. `SLASH_COMMAND_TOOL_CHAR_BUDGET` replaces it outright.
 *  3. Under the budget, every line is sent whole.
 *  4. Over it, **every skill keeps its name** and descriptions compete for what is left, taken
 *     greedily and skipped when they do not fit. So the listing never exceeds the budget unless the
 *     names alone do.
 *
 * 🔑 Two things follow, and both change advice rather than arithmetic. Past the budget the listing
 * is pinned near it, so switching one skill off saves almost nothing: the room goes to another
 * description. And a saving is therefore never a skill's own size. It is the listing before minus
 * the listing after, which is what `savedBy` computes.
 *
 * ⚠️ What this cannot see: Claude Code's own bundled skills sit in the same budget, always keep
 * their descriptions, and appear in no file. They only ever take room away, so the number here is
 * a ceiling on what the skills on disk cost, never a floor. The client also fills the room in
 * order of recent use, which decides *which* descriptions survive and barely moves the total, so
 * it is not modelled and no claim is made about which skill lost its description.
 */

import type { ResolvedSkill, SkillListingSettings } from '../resolve/types.js';
import { CHARS_PER_TOKEN } from './tokens.js';

export const SKILL_LISTING_DEFAULTS = {
  budgetFraction: 0.01,
  contextWindow: 200_000,
  maxDescChars: 1_536,
} as const;

/** The only larger window a transcript can prove: a turn that carried more than the default. */
export const EXTENDED_CONTEXT_WINDOW = 1_000_000;

/**
 * `full` is a line with its description, `name-only` is the `skillOverrides` state of that name,
 * and `hidden` is a skill the model is never told about: `off`, `user-invocable-only`, or
 * `disable-model-invocation` in its frontmatter. A hidden skill costs nothing.
 */
export type ListingForm = 'full' | 'name-only' | 'hidden';

export interface ListedSkill {
  /** Unique within one listing. Two plugins can ship the same skill name. */
  key: string;
  /** The name as the listing writes it: `plugin:name` for a plugin skill. */
  listingName: string;
  /**
   * Length of the description as sent: joined with `when_to_use` and already cut to the per-skill
   * cap. A length, not the text, because a skill that exists in no file on this machine is only
   * ever known by the size of the line a session recorded for it.
   */
  textChars: number;
  form: ListingForm;
  /**
   * Keeps its description whatever the budget, the way the client's own bundled skills do. Set for
   * a skill read out of a session record that no file accounts for.
   */
  pinned?: boolean;
}

export interface PackedSkillListing {
  /** Skills the model is told about at all. */
  listed: number;
  chars: number;
  /** The same skills with no budget, so the gap can be said out loud. */
  uncappedChars: number;
  budgetChars: number;
  overBudget: boolean;
  /** How many skills the budget reduced to a bare name. */
  demoted: number;
}

/** One key per skill, which a bare name is not: two plugins can ship the same one. */
export function skillKey(skill: Pick<ResolvedSkill, 'name' | 'plugin'>): string {
  return skill.plugin === null ? skill.name : `${skill.plugin}:${skill.name}`;
}

/**
 * The skills as the listing sees them. A shadowed copy is not listed at all, so it is dropped here
 * rather than carried as `hidden`.
 *
 * 🔑 `skillOverrides` does nothing to a plugin skill, in the client as well as in `fix`, so an
 * override naming one is ignored rather than believed.
 */
export function toListedSkills(skills: ResolvedSkill[], settings: SkillListingSettings): ListedSkill[] {
  const maxDescChars = settings.maxDescChars ?? SKILL_LISTING_DEFAULTS.maxDescChars;
  return skills
    .filter((skill) => skill.shadowedBy === null)
    .map((skill) => {
      const override = skill.plugin === null ? skill.override : null;
      const hidden = !skill.modelInvocable || override === 'off' || override === 'user-invocable-only';
      return {
        key: skillKey(skill),
        listingName: skill.plugin === null ? skill.name : `${skill.plugin.split('@')[0]}:${skill.name}`,
        textChars: listingText(skill.description, skill.whenToUse, maxDescChars).length,
        form: hidden ? 'hidden' : override === 'name-only' ? 'name-only' : 'full',
      };
    });
}

/**
 * The window the listing budget is a share of.
 *
 * No file says which window a session ran in, so this is inferred from the one thing that cannot
 * lie about it: a turn that carried more than the default window was not inside the default
 * window. That proves the window was larger and not how large, so the extended window is a guess
 * that can over-report, and the default one that can under-report. This is the fallback: the ledger
 * works the window back from a listing a session sent when there is one, and a row built on this
 * says it is modelled.
 */
export function inferContextWindow(peakContextTokens: number[]): number {
  return peakContextTokens.some((peak) => peak > SKILL_LISTING_DEFAULTS.contextWindow)
    ? EXTENDED_CONTEXT_WINDOW
    : SKILL_LISTING_DEFAULTS.contextWindow;
}

/** The description as the listing sends it. */
export function listingText(
  description: string,
  whenToUse: string | null,
  maxDescChars: number = SKILL_LISTING_DEFAULTS.maxDescChars,
): string {
  const joined = whenToUse === null || whenToUse === '' ? description : `${description} - ${whenToUse}`;
  return joined.length > maxDescChars ? `${joined.slice(0, maxDescChars - 1)}…` : joined;
}

export function skillListingBudgetChars(
  settings: SkillListingSettings,
  contextWindow: number = SKILL_LISTING_DEFAULTS.contextWindow,
): number {
  if (settings.envBudgetChars !== null) return settings.envBudgetChars;
  const fraction = settings.budgetFraction ?? SKILL_LISTING_DEFAULTS.budgetFraction;
  return Math.max(1, Math.floor(contextWindow * CHARS_PER_TOKEN * fraction));
}

/** `- name` */
const nameLine = (skill: ListedSkill): number => skill.listingName.length + 2;
/** `- name: text` */
const fullLine = (skill: ListedSkill): number => skill.listingName.length + 4 + skill.textChars;

export function packSkillListing(skills: ListedSkill[], budgetChars: number): PackedSkillListing {
  const listed = skills.filter((skill) => skill.form !== 'hidden');
  const separators = Math.max(0, listed.length - 1);
  const uncappedChars =
    listed.reduce((sum, skill) => sum + (skill.form === 'full' ? fullLine(skill) : nameLine(skill)), 0) +
    separators;

  if (uncappedChars <= budgetChars) {
    return {
      listed: listed.length,
      chars: uncappedChars,
      uncappedChars,
      budgetChars,
      overBudget: false,
      demoted: 0,
    };
  }

  // A pinned skill is charged whole before anything competes, which is the order the client uses.
  const floor =
    listed.reduce((sum, skill) => sum + (skill.pinned === true ? lineChars(skill) : nameLine(skill)), 0) +
    separators;
  let remaining = budgetChars - floor;
  let chars = floor;
  let demoted = 0;
  for (const skill of listed) {
    if (skill.form !== 'full' || skill.pinned === true) continue;
    const extra = fullLine(skill) - nameLine(skill);
    if (extra <= remaining) {
      remaining -= extra;
      chars += extra;
    } else {
      demoted += 1;
    }
  }

  return { listed: listed.length, chars, uncappedChars, budgetChars, overBudget: true, demoted };
}

/**
 * Characters the listing shrinks by when `removed` leave it, given everything in `alreadyRemoved`
 * has left first.
 *
 * Never negative. Freeing room can let one more description in, so the true change is
 * occasionally a few characters the other way, and reporting that as a saving of less than zero
 * would be a precise answer to a question nobody asked.
 */
export function savedBy(
  skills: ListedSkill[],
  budgetChars: number,
  removed: ReadonlySet<string>,
  alreadyRemoved: ReadonlySet<string> = new Set(),
): number {
  const before = skills.filter((skill) => !alreadyRemoved.has(skill.key));
  const after = before.filter((skill) => !removed.has(skill.key));
  return Math.max(0, packSkillListing(before, budgetChars).chars - packSkillListing(after, budgetChars).chars);
}

/** What one skill's line weighs when sent whole. The share a joint saving is split by. */
export function lineChars(skill: ListedSkill): number {
  return skill.form === 'full' ? fullLine(skill) : nameLine(skill);
}

/**
 * Split `total` across `weights` in whole numbers that add up to exactly `total`.
 *
 * 🔑 Under a budget a saving belongs to the set that left, not to any one skill in it, but a fix
 * plan is a list of actions and its total is their sum. Splitting by weight and handing the
 * rounding remainder to the largest fractions keeps the headline, the plan and the JSON saying the
 * same number, which three independently rounded figures do not.
 */
export function apportion(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0 || weightSum <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / weightSum);
  const shares = exact.map(Math.floor);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  let remainder = total - shares.reduce((sum, share) => sum + share, 0);
  for (const { index } of byFraction) {
    if (remainder <= 0) break;
    shares[index] += 1;
    remainder -= 1;
  }
  return shares;
}
