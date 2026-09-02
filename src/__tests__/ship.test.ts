/**
 * The promises on the tin, as tests.
 *
 * This package's pitch rests on three claims a reader cannot check by reading: it has no runtime
 * dependencies, it makes no network call except the MCP handshake it describes, and nothing leaves
 * the machine. Two of those are properties of the import graph, so they can be enforced instead of
 * asserted — and enforcement is what makes them survive the first time somebody reaches for a
 * convenience library at 2am.
 *
 * 🔑 The dependency test is the load-bearing one. A tool that audits supply-chain-shaped bloat and
 * ships nineteen transitive packages of its own has an argument it cannot make.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function manifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every bare specifier a file imports, ignoring relative paths. */
function bareImports(source: string): string[] {
  const out: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (!match[1].startsWith('.')) out.push(match[1]);
  }
  return out;
}

describe('what this package promises', () => {
  /**
   * 🔑 Zero runtime dependencies, enforced at the import graph rather than at the manifest.
   *
   * An empty `dependencies` block proves nothing on its own: a package can declare nothing and
   * still `import` something that only resolves because a sibling in the monorepo installed it,
   * which works locally and breaks the moment anybody runs `npx context-tax`.
   */
  it('imports nothing at runtime but Node built-ins', async () => {
    const files = await sourceFiles(join(packageRoot, 'src'));
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes('__tests__')) continue;
      for (const specifier of bareImports(await readFile(file, 'utf8'))) {
        if (!specifier.startsWith('node:')) {
          offenders.push(`${relative(packageRoot, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares no runtime dependencies either', async () => {
    const pkg = await manifest();
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  /**
   * The only outbound traffic is the `tools/list` handshake against servers already in the reader's
   * own config. `fetch` appears in exactly one module, which is the module that documents it.
   */
  it('makes network calls from one file only', async () => {
    const files = await sourceFiles(join(packageRoot, 'src'));
    const callers: string[] = [];
    for (const file of files) {
      if (file.includes('__tests__')) continue;
      if (/\bfetch\s*\(/.test(await readFile(file, 'utf8'))) callers.push(relative(packageRoot, file));
    }
    expect(callers).toEqual(['src/measure/client.ts']);
  });

  it('ships a runnable bin, a licence and a readme', async () => {
    const pkg = await manifest();
    expect(pkg.bin).toEqual({ 'context-tax': 'dist/index.js' });
    expect(pkg.files).toContain('dist');
    // Pinned rather than range-checked, so moving the floor is a deliberate edit with a reason
    // attached rather than a number that drifts. It is 20 because that is the lowest version the
    // suite can actually run on: vitest reaches rolldown, which imports `styleText` from node:util,
    // and that landed in Node 20. A version `engines` claims but CI cannot execute is an undefended
    // claim, which is the one thing this package is not allowed to print.
    expect(pkg.engines).toEqual({ node: '>=20' });
    // `bin` points into `dist`, so the entry point has to carry the shebang before tsc copies it.
    const cli = await readFile(join(packageRoot, 'src', 'index.ts'), 'utf8');
    expect(cli.startsWith('#!/usr/bin/env node\n')).toBe(true);
    for (const name of ['LICENSE', 'README.md']) {
      expect((await stat(join(packageRoot, name))).size).toBeGreaterThan(0);
    }
    // The README's licence badge is a fixed string, not a registry lookup. shields.io's npm
    // endpoint renders "package not found" whenever its lookup fails, and that wrong answer
    // then sits in GitHub's image cache long after the registry is healthy, so the badge was
    // still reading "package not found" while the registry served MIT. A fixed badge cannot
    // 404, but it also cannot notice a relicence, so the three have to be checked against each
    // other here: the manifest, the LICENSE file, and the badge a reader actually sees.
    expect(pkg.license).toBe('MIT');
    const licence = await readFile(join(packageRoot, 'LICENSE'), 'utf8');
    expect(licence.startsWith('MIT License')).toBe(true);
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
    expect(readme).toContain('license-MIT-blue');
  });

  it('gates publishing behind the checks', async () => {
    const scripts = (await manifest()).scripts as Record<string, string>;
    for (const step of ['typecheck', 'lint', 'test', 'build']) {
      expect(scripts.prepublishOnly).toContain(step);
    }
  });
});
