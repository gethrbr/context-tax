/**
 * What is loaded in a directory right now.
 *
 * This is the **config** half of the tool. It answers *"what is in your context"* and never touches
 * a transcript or a token count. Evidence answers *"did you use it"*, measurement answers *"what
 * does it cost"*, and the join multiplies them. They are kept apart because they fail differently:
 * config is exact but incomplete, evidence is exact and complete, cost is estimated.
 *
 * 🔒 **Nothing in this file may hold a credential.** `~/.claude.json` holds API keys under a
 * server's `env` and bearer tokens under its `headers`; `.mcp.json` can hold either. Every type
 * here therefore stores KEY NAMES and never values, and URLs arrive stripped of userinfo and query
 * string. The unredacted launch spec a spawn needs lives in a `Map` beside the config — see
 * `ResolveResult` — precisely so that `JSON.stringify` on the whole result cannot emit it.
 */

/** A file we looked for. Recorded whether or not it was there: absence is an answer. */
export interface ConfigSource {
  kind:
    | 'managed'
    | 'project-local'
    | 'project-shared'
    | 'user'
    | 'user-local'
    | 'mcp-project'
    | 'claude-json';
  path: string;
  present: boolean;
  /** Top-level keys found. Names only, and only from files whose values may be sensitive. */
  keys: string[];
}

export type McpTransport = 'stdio' | 'http' | 'sse' | 'unknown';

/**
 * Where a server was declared. This is not decoration: it decides which lever turns the server
 * off, and the four scopes take four different levers.
 */
export type McpScope = 'project-mcp-json' | 'user' | 'claude-json-project' | 'plugin';

/** How `--fix` would disable a server, given where it came from. */
export type McpFixLever =
  | { kind: 'disabledMcpjsonServers'; settingsPath: string }
  /**
   * `~/.claude.json`, at either of the two scopes that live there.
   *
   * 🔒 One lever, not two, and never a hand edit: that file holds live API keys and bearer tokens,
   * so this tool neither rewrites it nor backs it up — a backup would be a second copy of every
   * credential on the machine. `claude mcp remove` owns the file and is told which scope to look
   * in, because leaving the scope off makes the CLI guess when the same name exists in both.
   */
  | { kind: 'claude-mcp-remove'; command: string; scope: 'user' | 'local'; path: string }
  | { kind: 'enabledPlugins'; plugin: string; settingsPath: string }
  | { kind: 'none'; why: string };

/**
 * When a line item entered the config.
 *
 * 🔑 **The single rule that protects this tool's credibility** is that a server added yesterday is
 * never reported as dead weight, so every row carries this and the output always prints it. It is
 * a discriminated union rather than a nullable date because `unknown` has to be *said*, not
 * silently rendered as zero — that substitution is the whole failure mode.
 *
 * ⚠️ Derived from git, never from mtime. `git checkout` rewrites mtimes, so on a fresh clone every
 * server looks added-today and the guard inverts: the tool would go quiet exactly when it should
 * speak. `~/.claude.json` is not in a repo at all, which is why `unknown` is a first-class state
 * and not a bug.
 */
export type ConfiguredSince =
  | { known: true; iso: string; commit: string; via: 'git' }
  /** A plugin records when YOU installed it, which is the date that means anything here. */
  | { known: true; iso: string; commit: null; via: 'plugin-install' }
  | { known: false; reason: string };

export interface ResolvedMcpServer {
  name: string;
  transport: McpTransport;
  /** The executable only, e.g. `npx`. Never the arguments that may carry a key. */
  command: string | null;
  /** Argument count. The values are in the launch spec, not here. */
  argCount: number;
  /**
   * The package or entry point, when the shape is the near-universal `npx <pkg>` /
   * `node <path>`. It is the one argument a human needs to recognise the server, and it is taken
   * only from the first non-flag argument — never from anything following a flag, which is where
   * `--api-key value` puts a secret.
   */
  entry: string | null;
  /** Names only. A name like `SERVICE_API_KEY` is safe to print; its value never is. */
  envKeys: string[];
  /** Scheme, host, port and path. Userinfo and query string are dropped before this is set. */
  url: string | null;
  headerKeys: string[];
  scope: McpScope;
  /** The file that declared it. */
  path: string;
  /** Set when `scope` is `plugin`. */
  plugin: string | null;
  enabled: boolean;
  /** Why it is on or off, phrased so the output can print it verbatim. */
  enabledReason: string;
  fixLever: McpFixLever;
  configuredSince: ConfiguredSince;
}

/** The unredacted spec, kept out of the printable config. Only `measure/` ever reads it. */
export interface McpLaunchSpec {
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  url: string | null;
  headers: Record<string, string>;
}

/**
 * `skillOverrides` takes one of four values, not a boolean, and the difference is the product:
 * a skill only ever reached by typing `/name` can be hidden from the model at **zero** loss of
 * function, which a blunt on/off tool cannot express.
 */
export type SkillOverride = 'on' | 'name-only' | 'user-invocable-only' | 'off';

export type ItemScope = 'user' | 'project' | 'plugin';

export interface ResolvedSkill {
  name: string;
  description: string;
  scope: ItemScope;
  path: string;
  plugin: string | null;
  /**
   * Characters of `name: description`, which is what a listing line costs. **The body is
   * deliberately excluded** — it loads when the skill runs, so counting it would be this tool's
   * first lie and the most tempting one, because it is the bigger number.
   */
  listingChars: number;
  /** Set when a higher-precedence entry of the same name wins. Project beats user. */
  shadowedBy: ItemScope | null;
  override: SkillOverride | null;
}

export interface ResolvedAgent {
  name: string;
  description: string;
  scope: ItemScope;
  path: string;
  plugin: string | null;
  /** Agents list their tool grant too, so it is part of the line. */
  tools: string | null;
  listingChars: number;
  shadowedBy: ItemScope | null;
}

/**
 * A `/command`. Discovered and reported, but **not costed**: whether the body, the description or
 * nothing at all reaches the system prompt is not settled, and the measurement contract says an
 * unknown is labelled rather than estimated.
 */
export interface ResolvedCommand {
  name: string;
  scope: ItemScope;
  path: string;
  plugin: string | null;
  bytes: number;
}

/**
 * An instruction file that is part of the fixed prefix.
 *
 * ⚠️ `alwaysLoaded` is the distinction that keeps this row honest. A `CLAUDE.md` in a subdirectory
 * is injected only when a file under it is touched, so folding it into the per-turn prefix would
 * overstate the tax. Observed directly: this repo's `packages/frontend/CLAUDE.md` appeared in
 * context only after a frontend file was read.
 */
export interface MemoryFile {
  path: string;
  kind: 'user' | 'project-root' | 'project-nested' | 'memory-index';
  bytes: number;
  alwaysLoaded: boolean;
}

export interface ResolvedPlugin {
  /** `<plugin>@<marketplace>`, the key `enabledPlugins` uses. */
  id: string;
  enabled: boolean;
  /** Where the settings entry that enabled or disabled it lives. */
  enabledBy: string | null;
  installPath: string | null;
  scope: string | null;
  /** ISO date this machine installed it. The plugin's own git history is a different question. */
  installedAt: string | null;
}

/** Something we could not read or understand. Collected, never thrown. */
export interface Problem {
  path: string;
  message: string;
}

export interface ResolvedConfig {
  cwd: string;
  /** Repo root, when `cwd` is inside a git work tree. Needed for the `.mcp.json` lookup and dates. */
  repoRoot: string | null;
  /**
   * Where a fix writes when it has a free choice: `<project>/.claude/settings.local.json`.
   *
   * The `/skills` menu writes `skillOverrides` here, so a fix that wrote anywhere else would be
   * invisible to it, and `.local.` is the git-ignored half of the pair — this tool must not put a
   * personal tuning decision into a file the whole team shares.
   */
  settingsTarget: string;
  sources: ConfigSource[];
  mcpServers: ResolvedMcpServer[];
  skills: ResolvedSkill[];
  agents: ResolvedAgent[];
  commands: ResolvedCommand[];
  memory: MemoryFile[];
  plugins: ResolvedPlugin[];
  problems: Problem[];
}

/**
 * 🔒 Two fields, deliberately.
 *
 * `config` is safe to print and safe to `--json`. `launch` holds the command lines, environment
 * values and bearer tokens a spawn needs, and it is a **`Map` rather than a `Record` on purpose**:
 * `JSON.stringify` renders a Map as `{}`, so even a careless dump of the whole result emits
 * nothing. That is a second lock behind the first, not the first one.
 */
export interface ResolveResult {
  config: ResolvedConfig;
  launch: Map<string, McpLaunchSpec>;
}
