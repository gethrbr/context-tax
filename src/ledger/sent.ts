/**
 * The record, turned into the things the ledger prints.
 *
 * `evidence/record.ts` reads what a session sent. This file decides which session to believe, and
 * works out the three things only the record can know: what the skill listing really cost, which
 * skills reached the model with their description taken away, and what budget took them.
 *
 * 🔑 **The budget is read backwards out of the listing, never assumed.** The client caps the listing
 * at a share of the context window, and no file says how big that window is. A model of it got the
 * window wrong on the machine it was written on: it knew two sizes and the client was running a
 * third. A listing that lost descriptions is pinned against its budget, so the budget is the size of
 * that listing, and the window follows from it.
 */

import type { SentRecord, SentSkill, SessionEvidence } from '../evidence/types.js';
import { SKILL_LISTING_DEFAULTS } from '../measure/skill-listing.js';
import type { ListedSkill } from '../measure/skill-listing.js';
import { CHARS_PER_TOKEN } from '../measure/tokens.js';
import type { SkillListingSettings } from '../resolve/types.js';

export interface PickedRecord {
  session: SessionEvidence;
  record: SentRecord;
  /** `2026-09-21`. Every number read from the record is printed beside the day it was true. */
  day: string;
}

/**
 * The newest session worth reading, from sessions already sorted newest first.
 *
 * A session a person started is preferred over one a script did. `claude -p` is routinely run with
 * settings nobody works under, and a benchmark run that switched every plugin off would otherwise
 * become this machine's account of what its agent is sent.
 */
export function pickRecord(sessions: SessionEvidence[]): PickedRecord | null {
  const withRecord = sessions.filter((session) => session.record !== null);
  const session = withRecord.find((candidate) => !candidate.headless) ?? withRecord[0];
  if (session === undefined || session.record === null) return null;
  return { session, record: session.record, day: (session.firstSeen ?? '').slice(0, 10) };
}

export interface ListingBudget {
  chars: number;
  /** `env` and `under` are facts. `derived` is read off a pinned listing and is said with "about". */
  basis: 'env' | 'derived' | 'under';
  /** The context window that budget is a share of. `null` when nothing proves it. */
  windowTokens: number | null;
}

export interface SentListing {
  tokens: number;
  /** The list on its own, without the framing around it. What the budget is held against. */
  listChars: number;
  entries: number;
  /** Skills the budget reduced to a name. Not the ones set `name-only`, and not ones with nothing to say. */
  dropped: SentSkill[];
  budget: ListingBudget;
  /** What the list would run to with every description in it. */
  uncappedChars: number;
  /** A dropped skill that is in no file, so its description could not be sized. */
  uncappedIsFloor: boolean;
  /** Everything the listing holds, for the saving arithmetic: the files, plus what no file shows. */
  population: ListedSkill[];
  /** Listed in that session and switched off since, so the next session sends less than this. */
  hiddenSince: number;
}

/** Round numbers a budget is likely to be, because a window is a round number of tokens. */
const BUDGET_STEP = 1_000;

/**
 * How far past its own budget a recorded list can run. The client counts lines and separators and
 * the transcript holds the text around them too, so a list pinned at 30,000 is recorded as 30,001.
 */
const OVERSHOOT = 64;

function deriveBudget(listChars: number, smallestDropped: number | null): number {
  // 🔑 The client fills greedily and skips what does not fit, so when it stops, no dropped
  // description fits the room that is left. The budget is therefore about the size of the list, and
  // less than the list plus the smallest thing it turned away. A round number inside that gap is
  // the budget; with none there, the list itself is the closest honest answer.
  const ceiling = smallestDropped === null ? listChars : listChars + smallestDropped;
  const nearest = Math.round(listChars / BUDGET_STEP) * BUDGET_STEP;
  if (nearest >= listChars - OVERSHOOT && nearest < ceiling) return nearest;
  const above = Math.ceil(listChars / BUDGET_STEP) * BUDGET_STEP;
  return above < ceiling ? above : listChars;
}

export function readSentListing(
  record: SentRecord,
  listed: ListedSkill[],
  settings: SkillListingSettings,
): SentListing | null {
  const sent = record.skillListing;
  if (sent === null || sent.skills === null) return null;

  const byName = new Map(listed.map((skill) => [skill.listingName, skill]));
  const dropped: SentSkill[] = [];
  let uncappedChars = sent.listChars;
  let uncappedIsFloor = false;
  let smallestDropped: number | null = null;
  let hiddenSince = 0;

  const fraction = settings.budgetFraction ?? SKILL_LISTING_DEFAULTS.budgetFraction;
  // 🚨 A bare name only proves a budget when the list is big enough to have hit one. The smallest
  // window the client runs is 200,000 tokens, so no budget under this fraction is smaller than its
  // share of that. A 465-character list with one bare name is not a pinned list: read as one, it
  // derived "a window of about 12,000" and printed 292% on the first line. Under this floor the
  // bare names are skills with nothing to say, and nothing was taken away.
  const smallestBudget = SKILL_LISTING_DEFAULTS.contextWindow * CHARS_PER_TOKEN * fraction;
  const pinned = settings.envBudgetChars !== null || sent.listChars + OVERSHOOT >= smallestBudget;

  for (const skill of sent.skills) {
    const onDisk = byName.get(skill.name);
    if (onDisk?.form === 'hidden') hiddenSince += 1;
    if (skill.described || !pinned) continue;
    // A name alone is what the budget leaves, and also what `name-only` asks for and what a skill
    // with no description looks like. Only the first is something that was taken away.
    if (onDisk !== undefined && (onDisk.form !== 'full' || onDisk.textChars === 0)) continue;
    dropped.push(skill);
    if (onDisk === undefined) {
      uncappedIsFloor = true;
      continue;
    }
    const extra = onDisk.textChars + 2;
    uncappedChars += extra;
    smallestDropped = smallestDropped === null ? extra : Math.min(smallestDropped, extra);
  }

  const budget: ListingBudget =
    settings.envBudgetChars !== null
      ? { chars: settings.envBudgetChars, basis: 'env', windowTokens: null }
      : dropped.length === 0
        ? { chars: Math.max(sent.listChars, uncappedChars), basis: 'under', windowTokens: null }
        : (() => {
            const chars = deriveBudget(sent.listChars, smallestDropped);
            const windowTokens = Math.round(chars / (CHARS_PER_TOKEN * fraction) / 1_000) * 1_000;
            return { chars, basis: 'derived' as const, windowTokens };
          })();

  // What no file accounts for: the client's own bundled skills, and plugins this tool cannot
  // resolve. They sit in the same budget, so a saving computed without them is computed against
  // room that is not there. Pinned, because the ones that kept their description keep it.
  const unseen: ListedSkill[] = sent.skills
    .filter((skill) => !byName.has(skill.name))
    .map((skill) => ({
      key: `sent:${skill.name}`,
      listingName: skill.name,
      textChars: skill.described ? Math.max(0, skill.chars - skill.name.length - 4) : 0,
      form: skill.described ? ('full' as const) : ('name-only' as const),
      pinned: true,
    }));

  return {
    tokens: Math.round(sent.chars / CHARS_PER_TOKEN),
    listChars: sent.listChars,
    entries: sent.entries,
    dropped,
    budget,
    uncappedChars,
    uncappedIsFloor,
    population: [...unseen, ...listed],
    hiddenSince,
  };
}

/**
 * The smallest `skillListingBudgetFraction` at which every description is sent, and what it adds.
 *
 * `null` when the fraction is not the lever: the budget was set outright by the environment
 * variable, or nothing was dropped.
 */
export function fractionToSendAll(
  listing: SentListing,
  settings: SkillListingSettings,
): { fraction: number; addsTokens: number } | null {
  if (listing.budget.basis !== 'derived' || listing.dropped.length === 0) return null;
  const current = settings.budgetFraction ?? SKILL_LISTING_DEFAULTS.budgetFraction;
  // Rounded up at the third decimal: a fraction that lands one description short is the same
  // complaint again. The client accepts anything up to 1.
  const needed = Math.ceil((listing.uncappedChars / listing.budget.chars) * current * 1_000) / 1_000;
  if (needed > 1) return null;
  return {
    fraction: needed,
    addsTokens: Math.round(Math.max(0, listing.uncappedChars - listing.listChars) / CHARS_PER_TOKEN),
  };
}

/** Who a listed skill belongs to, from its listing name: the plugin before the colon, or the user. */
export function ownerOf(listingName: string): string | null {
  const colon = listingName.indexOf(':');
  return colon <= 0 ? null : listingName.slice(0, colon);
}
