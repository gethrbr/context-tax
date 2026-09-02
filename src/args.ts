/**
 * The command line, and the help text it has to agree with.
 *
 * This is a separate module because `index.ts` dispatches at module scope: importing it to test
 * the parser would run the CLI. A parser that cannot be called from a test is a parser that
 * drifts from the dispatch reading it, and that drift is exactly what went wrong here. The
 * dispatch compared `args.command` against `'--help'`, a value the parser could never produce,
 * so the branch was dead and the flag fell through to the default command.
 *
 * 🚨 Unrecognised flags are collected, never skipped. The version that ignored anything starting
 * with `-` turned `context-tax --help` into a ten second measurement that started every MCP
 * server in the config, and turned a typo like `--refres` into a silent no-op that looked like a
 * successful run. A tool whose entire subject is things that fail quietly cannot fail quietly
 * itself.
 */

export interface Args {
  command: string;
  json: boolean;
  color: boolean;
  cwd?: string;
  top: number;
  window: number;
  spawn: boolean;
  refresh: boolean;
  timeoutMs: number;
  dryRun: boolean;
  yes: boolean;
  /**
   * Everything wrong with the command line, collected rather than thrown so a single run reports
   * all of it. Non-empty means nothing should execute.
   */
  usageErrors: string[];
}

/**
 * 🔑 Every option the parser accepts. `HELP` is asserted against this list in the tests, so a
 * flag can no longer exist without being documented, and the help text can no longer promise one
 * that was never wired up.
 */
export const KNOWN_FLAGS = [
  '--help',
  '-h',
  '--version',
  '-v',
  '--cwd',
  '--json',
  '--no-color',
  '--top',
  '--window',
  '--no-spawn',
  '--refresh',
  '--timeout',
  '--dry-run',
  '--yes',
  '-y',
] as const;

export const HELP = `
  context-tax: what your coding agent's context costs you every turn.

    context-tax             what your context costs, and whether you used it
    context-tax fix         execute the findings, showing every changed line
    context-tax config      what is loaded in this directory right now
    context-tax measure     what it weighs, per server, per skill, per file
    context-tax evidence    what your sessions actually used (development view)

    --help, -h      print this and exit
    --version, -v   print the version and exit
    --cwd <path>    resolve for another directory
    --json          machine-readable output
    --no-color      plain text (NO_COLOR is honoured too)
    --top <n>       projects to list in the evidence view (default 12)
    --window <n>    recent sessions the exact total is taken from (default 10)
    --no-spawn      measure from cache and the bundled table; start nothing
    --refresh       ignore cached schemas and measure again
    --timeout <s>   per server, default 10
    --dry-run       fix: show the diff and stop, without asking to write
    --yes, -y       fix: skip the confirmation, required when stdin is not a tty

  No telemetry, no model call, and no context-tax server for anything to be sent
  to. The measure command performs the same tools/list handshake your agent
  performs at the start of every session, against the servers already in your
  own config, and prints every host it spoke to.

  fix is the only command that writes. It edits settings files, backs up what it
  replaces to ~/.cache/context-tax/backups/, and never touches ~/.claude.json,
  which sits beside your API keys.
`;

/**
 * A count or a duration. Rejecting instead of falling back matters: the old `Number(x) || default`
 * answered `--top ten` with 12 and said nothing, so the user read a number they had not asked for
 * and had no way to tell.
 */
function positiveNumber(raw: string, flag: string, errors: string[]): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${flag} needs a positive number, not ${JSON.stringify(raw)}.`);
    return undefined;
  }
  return value;
}

export function parseArgs(argv: string[]): Args {
  const usageErrors: string[] = [];
  const args: Args = {
    command: 'ledger',
    json: false,
    color: true,
    top: 12,
    window: 10,
    spawn: true,
    refresh: false,
    timeoutMs: 10_000,
    dryRun: false,
    yes: false,
    usageErrors,
  };
  const positional: string[] = [];
  // Recorded rather than applied, because the positional command is read after the loop and would
  // otherwise overwrite them: `context-tax measure --help` has to print the help, not spend ten
  // seconds measuring first.
  let wantsHelp = false;
  let wantsVersion = false;

  /** The value after a flag, or `undefined` with the error already recorded. */
  const valueAfter = (index: number, flag: string): string | undefined => {
    const next = argv[index + 1];
    // A `--` token in the value slot is a missing value, not a directory named `--json`.
    if (next === undefined || next.startsWith('--')) {
      usageErrors.push(`${flag} needs a value.`);
      return undefined;
    }
    return next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        wantsHelp = true;
        break;
      case '--version':
      case '-v':
        wantsVersion = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--no-color':
        args.color = false;
        break;
      case '--no-spawn':
        args.spawn = false;
        break;
      case '--refresh':
        args.refresh = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--yes':
      case '-y':
        args.yes = true;
        break;
      case '--cwd': {
        const raw = valueAfter(i, arg);
        if (raw === undefined) break;
        i += 1;
        args.cwd = raw;
        break;
      }
      case '--top':
      case '--window':
      case '--timeout': {
        const raw = valueAfter(i, arg);
        if (raw === undefined) break;
        i += 1;
        const parsed = positiveNumber(raw, arg, usageErrors);
        if (parsed === undefined) break;
        if (arg === '--top') args.top = parsed;
        else if (arg === '--window') args.window = parsed;
        else args.timeoutMs = parsed * 1000;
        break;
      }
      default:
        if (arg.startsWith('-')) usageErrors.push(`unknown option ${JSON.stringify(arg)}.`);
        else positional.push(arg);
    }
  }

  if (positional.length > 0) args.command = positional[0];
  // Running the first one and dropping the rest is how `context-tax measure fix` quietly becomes a
  // measurement, when the user plainly meant two different things.
  if (positional.length > 1) {
    usageErrors.push(`one command at a time, got ${positional.map((one) => JSON.stringify(one)).join(', ')}.`);
  }
  if (wantsVersion) args.command = 'version';
  // Help outranks version, and both outrank a positional command.
  if (wantsHelp) args.command = 'help';
  return args;
}
