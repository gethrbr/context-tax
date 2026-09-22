/**
 * The package version, read from the manifest at runtime.
 *
 * `../package.json` resolves the same way from `dist/version.js` and from `src/version.ts` under
 * tsx, and npm always ships the manifest. Importing it instead would drag a JSON file into
 * `rootDir` and change the shape of `dist/`. Read once: `--version` prints it, and the MCP
 * handshake sends it to every server as `clientInfo`, which is how a constant here once told
 * servers a 0.4.0 install was 0.1.0.
 */

import { readFileSync } from 'node:fs';

function read(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const value = (parsed as { version: unknown }).version;
      if (typeof value === 'string') return value;
    }
  } catch {
    /* falls through: a missing manifest is not a reason to fail a --version or a handshake */
  }
  return 'unknown';
}

export const PACKAGE_VERSION = read();
