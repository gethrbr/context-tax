/**
 * The ceiling on every denominator in the ledger: *where could this have been in context at all?*
 *
 * 🚨 Each case below is one wrong answer the tool used to be able to give. A `.mcp.json` server
 * judged against the machine's history was reported as never called across every session on it,
 * none of which had ever loaded it, and the sentence carried a real number and a real window,
 * which is what made it worth fixing rather than worth caveating.
 *
 * The direction of the default is the point of the last two tests: when provenance cannot be
 * established the answer is `project`, because refusing to widen makes no claim while widening
 * makes one.
 */

import { describe, expect, it } from 'vitest';

import { pluginReach, serverReach, skillReach } from '../ledger/reach.js';
import type { ConfigSource, ResolvedPlugin } from '../resolve/types.js';

const USER_SETTINGS = '/home/u/.claude/settings.json';
const PROJECT_SETTINGS = '/repo/.claude/settings.json';

const sources: ConfigSource[] = [
  { kind: 'user', path: USER_SETTINGS, present: true, keys: [] },
  { kind: 'user-local', path: '/home/u/.claude/settings.local.json', present: true, keys: [] },
  { kind: 'project-shared', path: PROJECT_SETTINGS, present: true, keys: [] },
  { kind: 'project-local', path: '/repo/.claude/settings.local.json', present: true, keys: [] },
  { kind: 'managed', path: '/Library/Application Support/ClaudeCode/managed-settings.json', present: true, keys: [] },
];

const enabledBy = (path: string | null): ResolvedPlugin[] => [
  { id: 'pack@market', enabled: true, enabledBy: path, installPath: null, scope: null, installedAt: null },
];

describe('how far an MCP server reaches', () => {
  it('a -s user server is loaded in every session on the machine', () => {
    expect(serverReach({ scope: 'user', plugin: null }, [], sources)).toBe('machine');
  });

  it('a .mcp.json server is loaded in one project', () => {
    expect(serverReach({ scope: 'project-mcp-json', plugin: null }, [], sources)).toBe('project');
  });

  /**
   * 🔑 The one that reads the wrong way round. It lives in `~/.claude.json`, which is a user-level
   * file, but the entry is filed under a single project directory: it is what `claude mcp add
   * -s local` writes, and `-s local` is the opposite of `-s user`.
   */
  it('a ~/.claude.json entry filed under one project is loaded in that project only', () => {
    expect(serverReach({ scope: 'claude-json-project', plugin: null }, [], sources)).toBe('project');
  });

  it('a plugin server reaches as far as the settings file that enabled the plugin', () => {
    expect(serverReach({ scope: 'plugin', plugin: 'pack@market' }, enabledBy(USER_SETTINGS), sources)).toBe('machine');
    expect(serverReach({ scope: 'plugin', plugin: 'pack@market' }, enabledBy(PROJECT_SETTINGS), sources)).toBe('project');
  });
});

describe('how far a skill reaches', () => {
  it('~/.claude/skills is everywhere and .claude/skills is here', () => {
    expect(skillReach({ scope: 'user', plugin: null }, [], sources)).toBe('machine');
    expect(skillReach({ scope: 'project', plugin: null }, [], sources)).toBe('project');
  });

  it('a plugin skill inherits the plugin, exactly as its servers do', () => {
    expect(skillReach({ scope: 'plugin', plugin: 'pack@market' }, enabledBy(USER_SETTINGS), sources)).toBe('machine');
    expect(skillReach({ scope: 'plugin', plugin: 'pack@market' }, enabledBy(PROJECT_SETTINGS), sources)).toBe('project');
  });
});

describe('an administrator outranks the user, so managed settings reach further, not less', () => {
  it('counts a managed enable as machine-wide', () => {
    const managed = '/Library/Application Support/ClaudeCode/managed-settings.json';
    expect(pluginReach('pack@market', enabledBy(managed), sources)).toBe('machine');
  });
});

describe('what it says when it cannot tell', () => {
  it('refuses to widen for a plugin nothing on record enabled', () => {
    expect(pluginReach('pack@market', [], sources)).toBe('project');
    expect(pluginReach(null, enabledBy(USER_SETTINGS), sources)).toBe('project');
  });

  it('refuses to widen for a settings file it has never heard of', () => {
    // A path that matches no known layer is not evidence of machine-wide reach, and a widened
    // denominator is a claim while a narrow one in a thin project is silence.
    expect(pluginReach('pack@market', enabledBy('/somewhere/else.json'), sources)).toBe('project');
  });
});
