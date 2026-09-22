/**
 * The `fix` screens the README shows, from the same fabricated project as `readme-ledger.ts`.
 *
 * 🔒 Fabricated. The paths, servers, skills and counts are invented, and the block in the README is
 * pinned to what `renderPlan` and `renderApplied` produce from this, so the docs cannot drift from
 * the code. The `before` file is the one a stranger is most likely to have: a `permissions` block
 * and nothing else, with an inline array, so the diff shows what a rewrite does to it.
 */

import { planFixes } from '../../fix/index.js';
import type { AppliedFile, FixAction, FixPlan } from '../../fix/types.js';

export const README_FIX_SETTINGS = '~/projects/storefront/.claude/settings.local.json';

export const README_FIX_BEFORE = `{
  "permissions": {
    "allow": ["Bash(npm run test:*)", "Read(./src/**)"],
    "deny": []
  }
}
`;

export function readmeFixActions(): FixAction[] {
  const settingsPath = README_FIX_SETTINGS;
  return [
    {
      kind: 'disable-mcpjson-server',
      server: 'figma',
      settingsPath,
      why: 'figma costs 300 tokens every turn and has never been called in 96 sessions since it was configured.',
      saves: 300,
    },
    {
      kind: 'disable-mcpjson-server',
      server: 'sentry',
      settingsPath,
      why: 'sentry costs 400 tokens every turn for 1 call in 96 sessions: 17,160,000 tokens of standing cost per use.',
      saves: 400,
    },
    {
      kind: 'skill-override',
      skill: 'changelog-writer',
      value: 'off',
      settingsPath,
      why: 'changelog-writer has not been invoked in 96 sessions here, by you or by the model.',
      saves: 0,
    },
    {
      kind: 'skill-override',
      skill: 'design-review',
      value: 'user-invocable-only',
      settingsPath,
      why:
        'design-review has only ever been typed as /design-review, never chosen by the model. This keeps the slash command and drops the description from the prompt.',
      saves: 0,
    },
    {
      kind: 'manual',
      command: 'claude mcp remove linear -s user',
      why:
        'linear costs 300 tokens every turn for 3 calls, counted over every session on record because nothing says when it was added.\nIt is declared in ~/.claude.json, which this tool does not write.',
    },
  ];
}

export async function readmeFixPlan(): Promise<FixPlan> {
  return planFixes(readmeFixActions(), { readText: async () => README_FIX_BEFORE });
}

export function readmeFixApplied(): AppliedFile[] {
  return [
    {
      path: README_FIX_SETTINGS,
      backup: '~/.cache/context-tax/backups/2026-09-02T10-00-00-000Z/~-projects-storefront-.claude-settings.local.json',
      created: false,
    },
  ];
}
