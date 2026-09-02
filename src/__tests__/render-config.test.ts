/**
 * The rendered screen.
 *
 * Two things are worth locking here. One is that the honesty blocks are not optional decoration —
 * the "not visible from local config" note and the "bodies are not counted" line are load-bearing
 * claims about what the number means, and a refactor that drops them turns a checkable tool into
 * one you have to trust. The other is that a secret must not survive rendering either: the
 * resolver's redaction is upstream of this, but `--no-color` output is what gets pasted into
 * issues, so the guarantee is asserted where it is consumed.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { palette } from '../render/color.js';
import { renderConfig } from '../render/config.js';
import { resolveConfig } from '../resolve/index.js';

let root: string;
let home: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'context-tax-render-'));
  home = join(root, 'home');
  repo = join(root, 'repo');
  await mkdir(join(home, '.claude'), { recursive: true });
  await mkdir(join(repo, '.claude'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * The width is pinned, not inherited from whatever terminal the suite happens to run in. A
 * renderer that wraps to the window is a renderer whose output changes shape between machines,
 * and an assertion on a sentence that wrapped in CI but not locally is a flake by construction.
 */
const WIDE = 200;

const render = async (width = WIDE): Promise<string> => {
  const { config } = await resolveConfig({ cwd: repo, home });
  return renderConfig(config, palette(false), width);
};

describe('renderConfig', () => {
  it('does not print a secret that reached the config files', async () => {
    await writeFile(
      join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          keyed: { command: 'npx', args: ['pkg'], env: { API_KEY: 'sk-LEAKED' } },
          bearer: { type: 'http', url: 'https://host/mcp', headers: { Authorization: 'Bearer LEAKED' } },
        },
      }),
      'utf8',
    );

    const screen = await render();
    expect(screen).not.toContain('sk-LEAKED');
    expect(screen).not.toContain('Bearer LEAKED');
    // The variable NAME is the useful half and is safe to show.
    expect(screen).toContain('API_KEY');
  });

  /** 🔑 The claim the whole screen rests on. Without it, the list reads as the whole context. */
  it('always states that account-level connectors are invisible to it', async () => {
    expect(await render()).toContain('NOT VISIBLE FROM LOCAL CONFIG');
  });

  /** 🔑 The counting rule, printed beside the count, so the number can be checked rather than trusted. */
  it('says out loud that skill bodies are not counted', async () => {
    await mkdir(join(repo, '.claude', 'skills', 'a'), { recursive: true });
    await writeFile(
      join(repo, '.claude', 'skills', 'a', 'SKILL.md'),
      '---\nname: a\ndescription: d\n---\n\nbody\n',
      'utf8',
    );

    expect(await render()).toContain('bodies load on use and are not counted');
  });

  it('says why a server is off, rather than only that it is', async () => {
    await writeFile(
      join(repo, '.mcp.json'),
      JSON.stringify({ mcpServers: { alpha: { command: 'alpha' } } }),
      'utf8',
    );

    const screen = await render();
    expect(screen).toContain('configured but off');
    expect(screen).toContain('not yet approved');
  });

  it('keeps a long origin inside its column instead of shunting the row right', async () => {
    const installPath = join(root, 'plugins', 'p');
    await mkdir(installPath, { recursive: true });
    await writeFile(
      join(installPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { gamma: { command: 'g' } } }),
      'utf8',
    );
    await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
    await writeFile(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: { 'a-very-long-plugin-name-indeed@a-long-marketplace': [{ scope: 'user', installPath }] },
      }),
      'utf8',
    );

    // A second server with a short origin, to compare the column against.
    await writeFile(
      join(repo, '.mcp.json'),
      JSON.stringify({ mcpServers: { alpha: { command: 'a' } } }),
      'utf8',
    );

    const lines = (await render()).split('\n');
    const long = lines.find((text) => text.includes('gamma'));
    const short = lines.find((text) => text.includes('alpha'));
    expect(long).toContain('…');
    // 🔑 The invariant, asserted rather than a hand-counted truncation point: the transport column
    // lands at the same offset whatever the origin's length.
    expect(long?.indexOf('stdio')).toBe(short?.indexOf('stdio'));
  });
});
