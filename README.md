<div align="center">

# context-tax

**What your coding agent's context costs you on every turn, and which of it you never used.**

[![npm](https://img.shields.io/npm/v/context-tax?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/context-tax)
[![CI](https://img.shields.io/github/actions/workflow/status/gethrbr/context-tax/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=ci)](https://github.com/gethrbr/context-tax/actions/workflows/ci.yml)
[![dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen?style=flat-square)](#zero-dependencies-and-a-test-that-proves-it)
[![node](https://img.shields.io/node/v/context-tax?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

```bash
npx context-tax
```

</div>

---

Every article about MCP context bloat ends with the same advice: **audit which tools your agent
actually calls, and prune the rest.** None of them automate that sentence. They tell you to do it by
hand.

This does it for you. It reads what your config loads, measures what that weighs, reads your own
session transcripts for what you actually called, and multiplies.

No install, no account, no sign-up, no telemetry, no LLM call, and no `context-tax` server for
anything to be sent to.

<br>

|  |  |
|:--|:--|
| **Exact where it can be** | The per-turn total comes from the `usage` your API calls were billed on, not from a guess |
| **Cost per *use*, not per turn** | A 800-token server used once in 96 sessions cost you 34M tokens, and that is the number that changes minds |
| **It writes the fix** | `context-tax fix` routes each finding to the lever that actually turns that thing off |
| **Zero runtime dependencies** | Not "few". None. [Asserted by a test](#zero-dependencies-and-a-test-that-proves-it) against the import graph |

<br>

## Contents

- [The report](#the-report)
- [Reading the table](#reading-the-table)
- [`context-tax fix`](#context-tax-fix)
- [Commands and flags](#commands-and-flags)
- [How it works](#how-it-works)
- [Why the numbers are trustworthy](#why-the-numbers-are-trustworthy)
- [Privacy](#privacy)
- [Use it as a library](#use-it-as-a-library)
- [FAQ](#faq)
- [Development](#development)

<br>

## The report

> [!NOTE]
> Every number and name below is **fabricated for illustration**, on an invented config. The screens
> are real renderer output, generated from a fixture, so the docs cannot drift from the code. Run
> `npx context-tax` to see your own.

```
  context-tax  ~/projects/storefront
  token counts are chars/4, measured within 4%; a server's schemas are counted
  whole, which is what you pay only if your client does not defer them
  tokens: what every turn carries. deferred: the schemas behind it, paid when
  something loads them.

  ┌───────────────────────┬──────────┬───────────┬────────┬────────┬───────────┐
  │ MCP SERVERS           │   tokens │  deferred │  share │  calls │  per call │
  ├───────────────────────┼──────────┼───────────┼────────┼────────┼───────────┤
  │ figma                 │      800 │      +610 │     2% │      0 │         - │
  │ github                │    1,200 │    +3,180 │     3% │    214 │      241K │
  │ linear                │      800 │    +2,040 │     2% │      3 │       11M │
  │ postgres              │        - │         - │      - │      0 │         - │
  │ sentry                │      800 │    +5,900 │     2% │      1 │       34M │
  ├───────────────────────┼──────────┼───────────┼────────┼────────┼───────────┤
  │ 14 skills             │    1,200 │         - │     3% │      1 │         - │
  │ 11 agents             │    2,400 │         - │     6% │      - │         - │
  │ 2 memory files        │    1,600 │         - │     4% │      - │         - │
  ├───────────────────────┼──────────┼───────────┼────────┼────────┼───────────┤
  │ unattributed          │   31,200 │           │    78% │        │           │
  │ EVERY TURN            │   40,000 │           │   100% │        │           │
  └───────────────────────┴──────────┴───────────┴────────┴────────┴───────────┘
    postgres: configured but off, so it was not started to find out
    11 agents: agent listings are not separable from the prompt
    2 memory files: memory files are read by the model, not called by it
    EVERY TURN is exact, from usage. Median cold start across your 10 most
    recent sessions.

  FINDINGS
    1. figma costs 800 tokens every turn and has never been called
       0 calls in 96 sessions since it was configured. Loading its schemas costs
       610 tokens more, every time something does.
       fix: add "figma" to disabledMcpjsonServers in
       ~/projects/storefront/.claude/settings.local.json
    2. github: 9 of its 26 tools have never been called
       create_gist, delete_file, fork_repo, list_gists, ... Their names and
       descriptions cost 415 tokens on every turn, and 1,102 tokens of schema
       you have never used waits behind them.
       fix: MCP has no per-tool switch. Ask the server for a narrower tool set,
       or drop the server.
    3. linear is loaded on every turn and used in 3 of 96 sessions
       800 tokens re-sent across 42,900 turns for 3 calls: 11,440,000 tokens of
       standing cost per use. Loading its schemas costs 2,040 tokens more, every
       time something does.
       fix: claude mcp remove linear -s user
    4. sentry is loaded on every turn and used in 1 of 96 sessions
       800 tokens re-sent across 42,900 turns for 1 call: 34,320,000 tokens of
       standing cost per use. Loading its schemas costs 5,900 tokens more, every
       time something does.
       fix: add "sentry" to disabledMcpjsonServers in
       ~/projects/storefront/.claude/settings.local.json
    5. 13 skills never invoked, either way
       changelog-writer, commit-helper, design-review, ...
       fix: set each to off in skillOverrides, or delete the ones you do not
       recognise

  NOT MEASURABLE HERE
    Your memory and instruction files are 1,600 tokens of every turn. This tool
    can tell you what they cost. It cannot tell you which of the instructions
    inside them your agent actually used. Nothing in a log can: that needs the
    model's attention, not your history.

    MCP connectors attached to your claude.ai account are also real context and
    appear in no file on this machine. Run /context in a session to see them.

  2,400 tokens per turn recoverable from the findings above.
  context-tax measure   what each line weighs, and how
  context-tax config    what is loaded, and from where
```

<br>

## Reading the table

**`per call` is the column that changes behaviour.**
A total makes people shrug, because every total looks like the cost of doing business. Cost per use
reads as a bill. The `sentry` row is not expensive because 800 tokens is a lot. It is expensive
because those 800 tokens were re-sent on every one of 42,900 turns, to be used once.

**`deferred` is the column nothing else knows to print.**
Current Claude Code does not put an MCP server's tool *schemas* in the prompt. It leaves the names
and descriptions in a listing and loads a schema when something reaches for it. So a server has two
costs, paid at different times, and one number would have to pick a lie.

**`unattributed` is the honest remainder.**
The total is exact, from `usage`. The rows are estimates from serialized bytes. The difference gets
its own row instead of being smeared across the numbers above it.

**A `-` is not a `0`.**
`postgres` is configured but switched off, so it was never started to find out what it weighs.
Reporting `0` there would under-report your tax and quietly recommend keeping something you pay for.
Two dead servers on a real machine is common, and neither had ever been noticed, because a server
that fails to load fails silently.

<br>

## `context-tax fix`

The report is the easy half. This is the half that changes something.

```bash
npx context-tax fix --dry-run     # show every line that would change, then stop
npx context-tax fix               # show it, ask, then write
```

### 1. It shows you the literal bytes

Not a summary of the change. A summary is a second description that can drift from the thing it
describes, so what you confirm is the diff itself.

```
  WILL CHANGE

    ~/projects/storefront/.claude/settings.local.json
      disable the figma MCP server
        0 calls in 96 sessions since it was configured.
      disable the sentry MCP server
        1 call in 96 sessions: 34,320,000 tokens of standing cost per use.
      set the changelog-writer skill to off
        Never invoked by you or by the model in 96 sessions.
      set the design-review skill to user-invocable-only
        You have run /design-review, but the model has never chosen it. This
        keeps the slash command and drops the description from the prompt.

      @@ -2,5 +2,10 @@
          "permissions": {
            "allow": ["Bash(npm run test:*)", "Read(./src/**)"],
            "deny": []
      +   },
      +   "disabledMcpjsonServers": ["figma", "sentry"],
      +   "skillOverrides": {
      +     "changelog-writer": "off",
      +     "design-review": "user-invocable-only"
          }
        }

  HANDED BACK TO YOU
    These do not live in a settings file this tool will write. Servers declared
    in ~/.claude.json sit beside live API keys, so context-tax neither edits
    that file nor backs it up: a backup would be a second copy of every
    credential.

    linear: 3 calls in 96 sessions, 11,440,000 tokens of standing cost per use.
    It is declared in ~/.claude.json, which this tool does not write.
      claude mcp remove linear -s user

  1,805 tokens per turn recovered by the changes above.
```

Notice the fourth action. `design-review` is not switched off, it is demoted to
`user-invocable-only`: typing `/design-review` keeps working, and only the description leaves the
model's prompt. That is a saving at **zero** loss of function, and a blunt on/off tool cannot express
it, so it tells you to delete something you use.

### 2. It asks

```
  Write this file? [y/N]
```

### 3. It writes, and tells you how to undo it

```
  Written.
    ~/projects/storefront/.claude/settings.local.json
      previous contents: ~/.cache/context-tax/b…s/settings.local.json.2026-09-02

  Restore any of them by copying the backup back over the file.
```

### Where each finding is routed

The lever is not the same for every row, and advice that names the wrong lever does nothing at all
while looking like it worked.

| Where the item came from | What `fix` does |
|:--|:--|
| `<repo>/.mcp.json` | adds it to `disabledMcpjsonServers` in `.claude/settings.local.json` |
| `~/.claude.json` | **prints `claude mcp remove <name> -s <scope>` for you to run** |
| a plugin | sets `enabledPlugins["<plugin>@<marketplace>"]: false`, scoped to this project |
| a skill | writes the right one of the four `skillOverrides` states |

### The rails on the write path

`fix` is a subcommand rather than a flag, on purpose. It is the only part of this package that
writes, and it should not be reachable by adding one word to a command you ran for a report.

- **Plans without touching disk**, which is what makes `--dry-run` worth trusting
- **Refuses to write when stdin is not a terminal** unless you pass `--yes`. A CLI that writes to a
  config file because it could not find anyone to ask is a CLI that writes to config files in CI
- **Backs up every file it replaces** to `~/.cache/context-tax/backups/`, directory `0700`, files `0600`
- **Writes temp-then-`rename`**, so an interrupted run leaves your old settings file intact
- **Never rewrites a settings file that does not parse.** A malformed one is usually a half-finished
  hand edit, and replacing it loses work. It is reported under `NOT TOUCHED` instead
- **Idempotent.** Run it twice and the second run says *already applied*
- **Never touches `~/.claude.json`.** That file sits beside your API keys and bearer tokens. It is
  not rewritten and not backed up either, because a backup would be a second copy of every
  credential on your machine

<br>

## Commands and flags

```
context-tax             what your context costs and whether you used it   (default)
context-tax fix         execute the findings, after showing every changed line
context-tax config      what is loaded here, and where each piece came from
context-tax measure     what each line item weighs, and how it was measured
context-tax evidence    what your sessions actually used
```

| Flag | |
|:--|:--|
| `--help`, `-h` | print the command and flag list, and exit |
| `--version`, `-v` | print the version, and exit |
| `--cwd <path>` | resolve for another directory |
| `--json` | machine-readable output |
| `--top <n>` | projects to list in the evidence view (default 12) |
| `--window <n>` | recent sessions the exact total is taken from (default 10) |
| `--no-spawn` | measure from cache and the bundled table; start nothing |
| `--refresh` | ignore cached schemas and measure again |
| `--timeout <s>` | per server, default 10 |
| `--dry-run` | `fix`: show the diff and stop |
| `--yes`, `-y` | `fix`: skip the confirmation |
| `--no-color` | plain text (`NO_COLOR` is honoured too) |

<br>

## How it works

Four passes and one join, kept apart because they fail differently.

```
  resolve  ─┐
  measure  ─┼─►  ledger  ─►  findings  ─►  fix
  evidence ─┘
```

| Pass | What it knows | Confidence |
|:--|:--|:--|
| `resolve/` | What is loaded here: the settings chain, `.mcp.json`, `~/.claude.json`, plugins, skills, agents, memory | Exact, but incomplete |
| `measure/` | What it weighs. Performs the same `initialize` then `tools/list` handshake your agent performs at session start, against the servers already in your config, over stdio, streamable HTTP or legacy SSE | Estimated |
| `evidence/` | What you called. Parses your local transcripts for `tool_use` blocks and `usage` | Exact, it is what you were billed |
| `ledger/` | The multiplication, and a verdict per row | The join |

To measure a server you have to start it. So `measure` prints every host it spoke to, caches schemas
for a week keyed on the **names** of your environment variables and never their values, and **will
not start a project server from a directory you are not standing in**, since running one executes
code from a repo you only pointed at.

<br>

## Why the numbers are trustworthy

The failure that kills a tool like this is telling somebody that a server they added on Tuesday is
dead weight. So it holds itself to a set of rules, and they are worth reading before you trust a
verdict.

<details>
<summary><b>No claim of dead weight without its denominator</b></summary>
<br>

Every verdict carries the window it was reached over, and prints it: *0 calls in 96 sessions since
it was configured*, never a bare "unused". `neverCalled` is unreachable in the type system without
one.

</details>

<details>
<summary><b>The age of a server comes from git, never from file mtimes</b></summary>
<br>

`git checkout` rewrites mtimes, so on a fresh clone an mtime-based tool thinks every server was
added today and goes quiet exactly when it should speak. Project servers are dated from `git log`,
plugin servers from *your* install record, and `~/.claude.json` servers are reported as **unknown
age, out loud**, which downgrades a finding to an upper bound rather than dressing a guess up as a
fact.

</details>

<details>
<summary><b>A per-tool finding is never quietly the whole server</b></summary>
<br>

If every tool a server declares looks unused while the server itself shows calls, its tools were
renamed and the evidence can no longer be attributed. Printing *"26 of its 26 tools have never been
called"* beside a row reading 214 calls is a contradiction a reader resolves by disbelieving both
numbers, so it is not printed.

</details>

<details>
<summary><b>The total is exact; the rows are estimates, and they never silently disagree</b></summary>
<br>

If the rows ever sum to more than the billed total, the estimator is wrong. The run says so and
exits non-zero instead of printing a negative remainder.

</details>

<details>
<summary><b>A mistyped <code>--cwd</code> is an error, not a report</b></summary>
<br>

Nothing project-scoped resolves under a path that is not there, so a typo would otherwise buy a
confident page of findings about a directory that does not exist.

</details>

<details>
<summary><b>Where the token ratio came from</b></summary>
<br>

Token counts are `chars / 4`, measured within 4%. The ratio was pre-registered and then checked by
execution: adding one MCP server to a real Claude Code prompt cost 912 tokens where `chars/4`
predicted 948.

That same measurement found something bigger. Current Claude Code **defers tool schemas**, loading
them on demand rather than carrying them in every prompt, so a server's schema bytes are what you
*would* pay if they were loaded, not what you pay per turn under a client that defers. A server's
names, descriptions and its (truncated) instructions blob are resident either way. That is why there
are two columns.

**No dollar figure is printed at all**, because a wrong dollar figure is more convincing than a
wrong token count.

</details>

And what it cannot answer at all, said in the output rather than in the small print: it can tell you
what your `CLAUDE.md` costs, but not which instructions inside it your agent used. Nothing in a log
can. That needs the model's attention, not your history.

<br>

## Privacy

This tool reads local files and starts the MCP servers you have already configured. That is the
whole of its network activity, and all of it is to hosts you chose.

- **No telemetry.** There is no endpoint to send it to.
- **No model call.** Every verdict is arithmetic.
- **No credentials read or copied.** Schema caching is keyed on the *names* of environment
  variables, never their values, and `~/.claude.json` is never written or backed up.
- **`fetch` appears in exactly one file**, which is the file that documents why.

#### Zero dependencies, and a test that proves it

Not "few". None. The suite asserts it against the import graph, because an empty `dependencies`
block proves nothing on its own: a package can declare nothing, still import something that only
resolves because a sibling installed it, work perfectly on the author's machine, and break the
moment anybody runs `npx`.

<br>

## Use it as a library

Each pass is exported on its own, because each is useful without the terminal rendering.

```ts
import { resolveConfig, scanEvidence, measureContext, buildLedger } from 'context-tax';

const cwd = process.cwd();

const resolved = await resolveConfig({ cwd });
const evidence = await scanEvidence({ cwd });
const measured = await measureContext(resolved, { cwd });

const ledger = buildLedger(resolved, measured, evidence);

for (const finding of ledger.findings) {
  console.log(finding.headline, '→', finding.saves ?? 'unknown', 'tokens/turn');
}
```

`planFixes` and `applyFixes` are exported too, so the write path is available without the CLI.

> [!WARNING]
> `resolveConfig` returns `{ config, launch }`. Only `config` is safe to serialize. `launch` holds
> the command lines, environment values and bearer tokens a spawn needs, and it is a `Map`
> precisely so that `JSON.stringify` on the whole result emits `{}` for it.

<br>

## FAQ

<details>
<summary><b>Does this work with anything other than Claude Code?</b></summary>
<br>

Not yet. The `resolve` and `evidence` passes read Claude Code's config chain and transcript format.
The `measure` pass is plain MCP and is client-agnostic, so most of the work needed for another
client is a second reader. Issues describing a client's config and log layout are welcome.

</details>

<details>
<summary><b>Will it break my setup?</b></summary>
<br>

Only `fix` writes, only after showing you the diff and asking, and it copies every file it replaces
to `~/.cache/context-tax/backups/` first. Restoring is a `cp`. It will not touch `~/.claude.json` at
all.

</details>

<details>
<summary><b>Why does it need to start my MCP servers?</b></summary>
<br>

A server's tool list is not in your config, it is in the server. The only way to know what a server
weighs is to ask it the same question your agent asks at session start. Results are cached for a
week, and `--no-spawn` skips it entirely and works from cache plus a bundled table for well-known
servers.

</details>

<details>
<summary><b>I have no findings. Is it broken?</b></summary>
<br>

It means every measured item cleared the bar, or that there is not yet enough history to say
anything defensible. The table still prints, so you can see the cost even where there is no verdict.
`context-tax config` will show you what was resolved and from where.

</details>

<details>
<summary><b>Why is <code>unattributed</code> so large?</b></summary>
<br>

Because it is honest. It holds the base system prompt, the built-in tool schemas, and anything this
tool cannot see. Those are real tokens you pay and it would be easy to hide them by only totalling
the rows. They are shown so the percentages mean something.

</details>

<br>

## Development

```bash
npm install
npm run typecheck    # tsc --noEmit, strict
npm run lint         # eslint, no-explicit-any is an error
npm test             # 193 tests
npm run build
```

Every guard in this package has been **mutation-checked**: the bug is put back and the test has to
fail. A test that has never been seen to fail is not evidence of anything.

Three of the bugs found that way were confident zeroes that looked entirely plausible on screen, and
each was found by running the tool against real projects rather than by reading it. One is worth
repeating as a rule, because it is the trap this whole category of tool falls into: **a finding the
tool cannot defend line by line is a bug in the tool.**

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

<br>

---

<div align="center">

[MIT](./LICENSE) · [Report an issue](https://github.com/gethrbr/context-tax/issues) · [Changelog](./CHANGELOG.md)

<sub>Built by the team behind [Harbor](https://gethrbr.com), a shared brain for your team's agents.</sub>

</div>
