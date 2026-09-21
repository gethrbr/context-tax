/**
 * The skill listing, costed as the client packs it.
 *
 * Every figure here is invented. The shapes are the ones that matter: a listing under its budget,
 * one over it, and one whose names alone do not fit.
 */

import { describe, expect, it } from 'vitest';

import {
  EXTENDED_CONTEXT_WINDOW,
  apportion,
  inferContextWindow,
  listingText,
  packSkillListing,
  savedBy,
  skillListingBudgetChars,
  toListedSkills,
} from '../measure/skill-listing.js';
import type { ListedSkill } from '../measure/skill-listing.js';
import type { ResolvedSkill, SkillListingSettings } from '../resolve/types.js';

const UNSET: SkillListingSettings = { budgetFraction: null, maxDescChars: null, envBudgetChars: null };

/** A skill whose whole line, `- name: text`, is exactly `lineChars` long. */
function listed(name: string, lineChars: number, form: ListedSkill['form'] = 'full'): ListedSkill {
  return { key: name, listingName: name, textChars: lineChars - name.length - 4, form };
}

function resolvedSkill(overrides: Partial<ResolvedSkill> = {}): ResolvedSkill {
  return {
    name: 'deploy',
    description: 'Ships the service.',
    whenToUse: null,
    modelInvocable: true,
    scope: 'user',
    path: '/home/.claude/skills/deploy/SKILL.md',
    plugin: null,
    listingChars: 0,
    shadowedBy: null,
    override: null,
    ...overrides,
  };
}

describe('the text of one line', () => {
  it('joins when_to_use to the description the way the client does', () => {
    expect(listingText('Ships the service.', 'Before a release.')).toBe('Ships the service. - Before a release.');
    expect(listingText('Ships the service.', null)).toBe('Ships the service.');
  });

  it('🚨 cuts a long description at the cap, ellipsis included, instead of costing all of it', () => {
    const text = listingText('d'.repeat(5_000), null);
    expect(text.length).toBe(1_536);
    expect(text.endsWith('…')).toBe(true);
    expect(listingText('d'.repeat(5_000), null, 100).length).toBe(100);
  });
});

describe('the budget', () => {
  it('is 1% of the window in characters, so 8,000 at the default window', () => {
    expect(skillListingBudgetChars(UNSET)).toBe(8_000);
    expect(skillListingBudgetChars(UNSET, EXTENDED_CONTEXT_WINDOW)).toBe(40_000);
  });

  it('follows skillListingBudgetFraction, and the environment variable replaces both', () => {
    expect(skillListingBudgetChars({ ...UNSET, budgetFraction: 0.05 })).toBe(40_000);
    expect(skillListingBudgetChars({ ...UNSET, budgetFraction: 0.05, envBudgetChars: 1_234 })).toBe(1_234);
  });

  it('assumes the default window unless a turn proves a bigger one', () => {
    expect(inferContextWindow([])).toBe(200_000);
    expect(inferContextWindow([90_000, 199_000])).toBe(200_000);
    expect(inferContextWindow([90_000, 412_000])).toBe(EXTENDED_CONTEXT_WINDOW);
  });
});

describe('packing', () => {
  it('sends every line whole under the budget, newlines counted', () => {
    const packed = packSkillListing([listed('one', 400), listed('two', 800)], 8_000);
    expect(packed).toMatchObject({ listed: 2, chars: 1_201, uncappedChars: 1_201, overBudget: false, demoted: 0 });
  });

  it('🚨 never costs more than the budget, however much is on disk', () => {
    // Sixty skills of 1,000 characters each is 60,000 on disk. The model is sent 8,000 at most,
    // and the old sum reported all 60,000.
    const skills = Array.from({ length: 60 }, (_, index) => listed(`skill-${index}`, 1_000));
    const packed = packSkillListing(skills, 8_000);
    expect(packed.overBudget).toBe(true);
    expect(packed.uncappedChars).toBeGreaterThan(60_000);
    expect(packed.chars).toBeLessThanOrEqual(8_000);
    expect(packed.listed).toBe(60);
    expect(packed.demoted).toBeGreaterThan(50);
  });

  it('skips a description that does not fit and still takes a later one that does', () => {
    // Names: `- big` 5, `- small` 7, one newline: 13. Budget 120 leaves 107 for descriptions.
    // `big` wants 495 and is skipped; `small` wants 93 and fits.
    const packed = packSkillListing([listed('big', 500), listed('small', 100)], 120);
    expect(packed.chars).toBe(13 + 93);
    expect(packed.demoted).toBe(1);
  });

  it('keeps every name even when the names alone are over the budget', () => {
    const skills = Array.from({ length: 10 }, (_, index) => listed(`skill-${index}`, 300));
    const names = skills.reduce((sum, skill) => sum + skill.listingName.length + 2, 0) + 9;
    const packed = packSkillListing(skills, 20);
    expect(packed.chars).toBe(names);
    expect(packed.demoted).toBe(10);
  });

  it('charges a name-only skill its name and a hidden skill nothing', () => {
    const packed = packSkillListing(
      [listed('shown', 400), listed('named', 400, 'name-only'), listed('gone', 400, 'hidden')],
      8_000,
    );
    expect(packed.listed).toBe(2);
    expect(packed.chars).toBe(400 + 1 + '- named'.length);
  });
});

describe('what leaving the listing saves', () => {
  it('is the line and its newline while the listing is under its budget', () => {
    const skills = [listed('one', 400), listed('two', 800)];
    expect(savedBy(skills, 8_000, new Set(['one']))).toBe(401);
    expect(savedBy(skills, 8_000, new Set(['one', 'two']))).toBe(1_201);
  });

  it('🚨 is almost nothing past the budget, because the room goes to another description', () => {
    const skills = Array.from({ length: 60 }, (_, index) => listed(`skill-${index}`, 1_000));
    const saved = savedBy(skills, 8_000, new Set(['skill-0', 'skill-1', 'skill-2']));
    // Three 1,000-character lines left. A sum of lines says 3,000; the listing barely moved.
    expect(saved).toBeLessThan(1_000);
  });

  it('charges a second finding against what the first one left behind', () => {
    const skills = [listed('one', 400), listed('two', 800)];
    const first = savedBy(skills, 8_000, new Set(['one']));
    const second = savedBy(skills, 8_000, new Set(['two']), new Set(['one']));
    expect(first + second).toBe(savedBy(skills, 8_000, new Set(['one', 'two'])));
  });

  it('is never negative, even when freeing room lets one more description in', () => {
    // Names 5 + 5 + 9 and two newlines: 21. At budget 80 that leaves 59, so `aaa` (50 more) fits
    // and `bbb` (15 more) does not: 71. Take `padpadp` away and everything fits whole: 76.
    const skills = [listed('aaa', 55), listed('bbb', 20), listed('padpadp', 20, 'name-only')];
    const before = packSkillListing(skills, 80).chars;
    const after = packSkillListing(skills.slice(0, 2), 80).chars;
    expect(after).toBeGreaterThan(before);
    expect(savedBy(skills, 80, new Set(['padpadp']))).toBe(0);
  });
});

describe('apportion', () => {
  it('splits by weight into whole numbers that add up exactly', () => {
    const shares = apportion(100, [1, 1, 1]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
    expect(shares).toEqual([34, 33, 33]);
    expect(apportion(300, [400, 800])).toEqual([100, 200]);
  });

  it('gives nothing when there is nothing to give', () => {
    expect(apportion(0, [5, 5])).toEqual([0, 0]);
    expect(apportion(10, [])).toEqual([]);
  });
});

describe('from a resolved config to a listing', () => {
  it('writes a plugin skill under its plugin prefix, which is part of what the line costs', () => {
    const [skill] = toListedSkills([resolvedSkill({ plugin: 'pack@market', scope: 'plugin' })], UNSET);
    expect(skill.listingName).toBe('pack:deploy');
  });

  it('hides what the model is never told about', () => {
    const forms = toListedSkills(
      [
        resolvedSkill({ name: 'a', override: 'off' }),
        resolvedSkill({ name: 'b', override: 'user-invocable-only' }),
        resolvedSkill({ name: 'c', modelInvocable: false }),
        resolvedSkill({ name: 'd', override: 'name-only' }),
        resolvedSkill({ name: 'e', override: 'on' }),
      ],
      UNSET,
    ).map((skill) => skill.form);
    expect(forms).toEqual(['hidden', 'hidden', 'hidden', 'name-only', 'full']);
  });

  it('🚨 ignores an override on a plugin skill, because the client does', () => {
    const [skill] = toListedSkills(
      [resolvedSkill({ plugin: 'pack@market', scope: 'plugin', override: 'off' })],
      UNSET,
    );
    expect(skill.form).toBe('full');
  });

  it('drops a shadowed copy, which is not listed at all', () => {
    expect(toListedSkills([resolvedSkill({ shadowedBy: 'project' })], UNSET)).toEqual([]);
  });

  it('cuts descriptions at skillListingMaxDescChars when it is set', () => {
    const [skill] = toListedSkills(
      [resolvedSkill({ description: 'd'.repeat(500) })],
      { ...UNSET, maxDescChars: 120 },
    );
    expect(skill.textChars).toBe(120);
  });
});
