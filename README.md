<div align="center">

# context-tax

**What Claude Code sends on every turn before you type a word: what it costs, which of it you never
used, and which of it never reached your agent at all.**

[![npm](https://img.shields.io/npm/v/context-tax?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/context-tax)
[![CI](https://img.shields.io/github/actions/workflow/status/gethrbr/context-tax/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=ci)](https://github.com/gethrbr/context-tax/actions/workflows/ci.yml)
[![dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen?style=flat-square)](#zero-dependencies-and-a-test-that-proves-it)
[![node](https://img.shields.io/node/v/context-tax?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

```bash
npx context-tax
```

**For [Claude Code](https://claude.com/claude-code).**

</div>

---

Every article about MCP context bloat ends with the same advice: **audit which tools your agent
actually calls, and prune the rest.** None of them automate that sentence. They tell you to do it by
hand.

This does it for you. Your session transcripts already record what Claude Code sent to the model, so
it reads that instead of guessing: the skill listing as it went out, the tool names, your instruction
files, the client's own tools. It reads the same transcripts for what you actually called, and
multiplies.

No install, no account, no sign-up, no telemetry, no LLM call, and no `context-tax` server for
anything to be sent to.

<br>

|  |  |
|:--|:--|
| **Read, not modelled** | Rows come from what a recent session sent, measured on the text itself. The per-turn total comes from the `usage` your API calls were billed on |
| **What your agent never received** | Past its budget, Claude Code sends a skill as a bare name with no description. This counts them, says whose they are, and prices sending them all |
| **Cost per *use*, not per turn** | A 400-token server used once in 96 sessions cost you 17M tokens, and that is the number that changes minds |
| **It writes the fix** | `context-tax fix` routes each finding to the lever that actually turns that thing off |
| **Two screens made to be shared** | A [receipt](#the-receipt) and a [picture of one session](#one-session-as-a-picture), with no server name, skill name or path on either |
| **Zero runtime dependencies** | Not "few". None. [Asserted by a test](#zero-dependencies-and-a-test-that-proves-it) against the import graph |

<br>

## Contents

- [The report](#the-report)
- [Reading the table](#reading-the-table)
- [What your agent never received](#what-your-agent-never-received)
- [The receipt](#the-receipt)
- [One session as a picture](#one-session-as-a-picture)
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
  on this machine: 96 sessions, 42,900 turns, 1.7B tokens of context carried.
  You typed /clear 118, /compact 31.

  40,000 tokens on every turn, 20% of a window of about 200,000, before you type
  a word. 1,900 of them are recoverable from the 7 findings below.

  ┌───────────────────────┬──────────┬───────────┬────────┬────────┬───────────┐
  │ MCP SERVERS           │   tokens │  deferred │  share │  calls │  per call │
  ├───────────────────────┼──────────┼───────────┼────────┼────────┼───────────┤
  │ figma                 │      300 │    +1,110 │     1% │      0 │         - │
  │ github                │      700 │    +3,680 │     2% │    214 │      140K │
  │ linear                │      300 │    +2,540 │     1% │      3 │      4.3M │
  │ postgres              │        - │         - │      - │      0 │         - │
  │ sentry                │      400 │    +6,300 │     1% │      1 │       17M │
  │ claude_ai_Notion      │      900 │         - │     2% │      2 │       19M │
  ├───────────────────────┼──────────┼───────────┼────────┼────────┼───────────┤
  │ 31 skills             │    2,000 │         - │     5% │      1 │         - │
  │ 11 agents             │    2,400 │         - │     6% │      - │         - │
  │ 2 memory files        │    1,600 │         - │     4% │      - │         - │
  │ your hooks            │      400 │         - │     1% │      - │         - │
  ├───────────────────────┼──────────┼───────────┼────────┼────────┼───────────┤
  │ CLAUDE CODE ITSELF    │          │           │        │        │           │
  │ its 14 tools          │   22,000 │         - │    55% │      - │         - │
  │ its system prompt     │    3,200 │         - │     8% │      - │         - │
  │ its tool name list    │      400 │         - │     1% │      - │         - │
  │ its session details   │      600 │         - │     2% │      - │         - │
  ├───────────────────────┼──────────┼───────────┼────────┼────────┼───────────┤
  │ unattributed          │    4,800 │           │    12% │        │           │
  │ EVERY TURN            │   40,000 │           │   100% │        │           │
  └───────────────────────┴──────────┴───────────┴────────┴────────┴───────────┘
    postgres: configured but off, so nothing was started to measure
    31 skills: as sent in your session of 2026-09-01: 9 skills went as a name
      with no description, because Claude Code caps this listing at about 8,000
      characters, its share of a window of about 200,000 tokens
    11 agents: agent listings are not separable from the prompt
    2 memory files: the model reads these, it does not call them, so no log
      can say which lines were used
    your hooks: what your hooks put in front of the first turn. A hook that
      adds context on every prompt adds this much again each time
    its 14 tools, its system prompt, its tool name list, its session details:
      sent by Claude Code itself on every turn, so there is nothing here to
      switch off
    EVERY TURN is exact, from usage. Median first request across your 10 most
    recent sessions, 2026-08-24 to 2026-09-01.
    Rows are what your session of 2026-09-01 sent, read from its transcript. A
    row that says otherwise was weighed from your config.
    token counts are chars/4, measured within 4%; a server's schemas are counted
    whole, which is what you pay only if your client does not defer them.
    tokens: what every turn carries. deferred: the schemas behind it, paid when
    something loads them.

  FINDINGS
    1. 9 of your 31 skills reach the model as a name with no description
       design-kit 7 of 12, your own 2 of 14 (release-notes, db-migrate). A bare
       name gives the model nothing to choose a skill by. The cap is about 8,000
       characters and yours needs about 11,640. From your session of 2026-09-01;
       who loses out shifts with recent use.
       fix: set skillListingBudgetFraction to 0.015 and every description is
       sent, for about 910 more tokens on every turn (context-tax fix
       --restore-descriptions writes it). Or make room: each skill switched off
       below hands its space to another description
    2. figma costs 300 tokens every turn and has never been called
       0 calls in 96 sessions since it was configured. Loading its schemas costs
       1,110 tokens more, every time something does.
       fix: add "figma" to disabledMcpjsonServers in
       ~/projects/storefront/.claude/settings.local.json
    3. github: 9 of its 26 tools have never been called
       create_gist, delete_file, fork_repo, list_gists, ... Their names and
       descriptions cost 415 tokens on every turn, and 1,102 tokens of schema
       you have never used waits behind them.
       fix: MCP has no per-tool switch. Ask the server for a narrower tool set,
       or drop the server.
    4. linear is loaded on every turn and used in 3 of 96 sessions on this
       machine
       300 tokens re-sent across 42,900 turns for 3 calls: 4,290,000 tokens of
       standing cost per use, counted over every session on record because
       nothing says when this was added, so read it as an upper bound. Loading
       its schemas costs 2,540 tokens more, every time something does.
       fix: claude mcp remove linear -s user
    5. sentry is loaded on every turn and used in 1 of 96 sessions
       400 tokens re-sent across 42,900 turns for 1 call: 17,160,000 tokens of
       standing cost per use. Loading its schemas costs 6,300 tokens more, every
       time something does.
       fix: add "sentry" to disabledMcpjsonServers in
       ~/projects/storefront/.claude/settings.local.json
    6. claude_ai_Notion is sent on every turn and used in 2 of 96 sessions on
       this machine
       900 tokens of tool names and instructions across 42,900 turns for 2
       calls. No file on this machine declares it, so its age is unknown and the
       per-call figure is an upper bound.
       fix: no file here declares it, so there is nothing for this tool to edit.
       /mcp in a session shows where it is connected from, and a claude.ai
       connector is switched off in your claude.ai settings
    7. 13 skills never invoked, either way
       The listing is over its budget, so most of what this frees goes to
       another description rather than out of the prompt. changelog-writer,
       commit-helper, db-migrate, ...
       fix: set each to off in skillOverrides, or delete the ones you do not
       recognise

  NOT MEASURABLE HERE
    Your memory and instruction files are 1,600 tokens of every turn. This tool
    can tell you what they cost. It cannot tell you which of the instructions
    inside them your agent actually used. Nothing in a log can: that needs the
    model's attention, not your history.

    MCP connectors attached to your claude.ai account appear in no file on this
    machine. The ones your session connected are rows above, read from what it
    sent.

  1,900 tokens per turn recoverable from the findings above.
  context-tax measure   what each line weighs, and how
  context-tax config    what is loaded, and from where
```

<br>

## Reading the table

**The first line is the whole report in one sentence.**
How much is sent before you type, what share of your window that is, and how much of it you can get
back. The share is only printed when a session proves the window it is a share of. Without one there
is no percentage at all, because a percentage of an assumed window is a guess wearing a decimal point.

**`per call` is the column that changes behaviour.**
A total makes people shrug, because every total looks like the cost of doing business. Cost per use
reads as a bill. The `sentry` row is not expensive because 400 tokens is a lot. It is expensive
because those 400 tokens were re-sent on every one of 42,900 turns, to be used once.

**The rows are read from what a session sent.**
A recent Claude Code writes what it sent into the session transcript: the skill listing, the tool
names, each instruction file, its own tools and system prompt. The line under the table names the
session the rows came from. With no such session on the machine, the rows are weighed from your
config instead, and the same line says that.

**`deferred` is the column nothing else knows to print.**
Current Claude Code does not put an MCP server's tool *schemas* in the prompt. It sends the tool
names and the server's instructions, and loads a schema when something reaches for it. So a server
has two costs, paid at different times, and one number would have to pick a lie.

**`claude_ai_Notion` appears in no file on the machine.**
A connector attached to a claude.ai account is real context, and no config file declares it. It is a
row here because the session sent it. There is nothing for `fix` to edit, so the finding says where
it is switched off instead.

**`CLAUDE CODE ITSELF` is the part you cannot switch off.**
The client's own tools and system prompt are usually the largest lines on the screen. They are
itemised so the rows above them read in proportion: on the invented machine above, every MCP server
together is about an eighth of what the built-in tools weigh.

**`unattributed` is the honest remainder.**
The total is exact, from `usage`. The rows are measured on text, and tokens are estimated from
characters. The difference gets its own row instead of being smeared across the numbers above it.

**A `-` is not a `0`, and a `0` is not a guess.**
`postgres` is configured but switched off, so it was never started to find out what it weighs.
Reporting `0` there would under-report your tax and quietly recommend keeping something you pay for.
A server that does show `0` is one the session tried and could not connect to: it sent nothing, and
the row says so, because a server that fails to load fails silently everywhere else.

<br>

## What your agent never received

Claude Code gives the skill listing a budget: 1% of the context window, in characters. Every skill
keeps its name. Descriptions compete for what is left, and the ones that lose are sent as a bare
name. A bare name gives the model nothing to choose a skill by, so a skill you installed last week
can be invisible in every session since, and nothing on screen says so.

It is the first finding when it happens (finding 1 in the report above), because it is the only one
about what your agent is missing rather than what you are overpaying.

It is read from the listing a session sent, entry by entry, so it is a count and not an estimate. It
is grouped by who owns the skills, because the usual cause is one large plugin crowding out your own.
And it prices the two ways out: raise `skillListingBudgetFraction` and pay for every description, or
switch skills off below and hand their room to the ones you want.

`context-tax fix --restore-descriptions` writes the first one. It is never part of a plain `fix`,
because it is the one change in this tool that makes every turn cost **more**, and that should be
something you asked for by name.

<br>

## The receipt

```bash
npx context-tax receipt
```

```
                   CONTEXT TAX
       sent on every turn, before you type
  ----------------------------------------------
  Claude Code's own tools (14)            22,000
  Claude Code's system prompt              3,200
  MCP servers (5)                          2,600
  Agent listing (11)                       2,400
  Skill listing (31)                       2,000
    9 sent as a name, no description
  Instruction files (2)                    1,600
  Tool names, session details              1,000
  Your hooks                                 400
  Not itemised                             4,800
  ----------------------------------------------
  TOTAL PER TURN                          40,000
  20% of a window of about 200,000 tokens
  ----------------------------------------------
  SO FAR                            42,900 turns
                             1.7B tokens carried
  RECOVERABLE PER TURN                     1,900
  ----------------------------------------------
  npx context-tax                     2026-09-02
  read from what a session sent · chars/4
```

<br>

## One session as a picture

```bash
npx context-tax session                  # your longest session here, in the terminal
npx context-tax session --svg tax.svg    # the same picture as an image
npx context-tax session 4f2a             # a session by the start of its id
```

<p align="center">
  <img src="https://raw.githubusercontent.com/gethrbr/context-tax/main/docs/session.svg" alt="One coding-agent session, turn by turn: context climbs, the client compacts, and it never drops under the fixed prefix" width="820">
</p>

A long session is a sawtooth. Context climbs, the client compacts, it drops, it climbs again. The
drop never reaches the bottom of the chart. The band it lands on is the fixed prefix: the same tokens
the main screen itemises, sent again on the turn after every compaction and on every turn between.

```
  context-tax session  2026-09-01

   186K │                            ▂▇█                          ▂▃          
        │              ▃▆▇         ▁▆███                        ▂▆██          
        │            ▃▇███        ▅█████          ▂▆▆         ▂▆████          
        │          ▅██████      ▂███████        ▃▆███       ▁▆██████          
        │       ▁▅████████     ▆████████      ▃▇█████     ▁▆████████        ▃▆
        │     ▁▄██████████   ▃██████████    ▂▇███████    ▄██████████     ▁▄███
        │   ▁▅████████████  ▆███████████  ▂▆█████████  ▃████████████   ▂▆█████
        │  ▄██████████████▁█████████████ ▅███████████▁▆█████████████ ▃▇███████
        │▂██████████████████████████████████████████████████████████▇█████████
    41K │█████████████████████████████████████████████████████████████████████
        │█████████████████████████████████████████████████████████████████████
      0 │█████████████████████████████████████████████████████████████████████
        └────────────────▴─────────────▴────────────▴──────────────▴──────────

  640 turns, peak 186,000 tokens, compacted 4 times, and never under 41,200.
  ▴ marks a compaction. The band at the bottom is what a compaction cannot
  remove: 41,200 tokens. The session opened at 40,000, before a word of work,
  and that is the part the main screen itemises.

  context-tax session --svg <file>   the same picture, to post
```

Every value is exact, from the `usage` on each reply. The image carries numbers and nothing else: no
path, no session id, no project name.

<br>

## `context-tax fix`

The report is the easy half. This is the half that changes something.

```bash
npx context-tax fix --dry-run                  # show every line that would change, then stop
npx context-tax fix                            # show it, ask, then write
npx context-tax fix --restore-descriptions     # also raise the skill listing budget
```

### 1. It shows you the literal bytes

Not a summary of the change. A summary is a second description that can drift from the thing it
describes, so what you confirm is the diff itself.

```
  WILL CHANGE

    ~/projects/storefront/.claude/settings.local.json
      disable the figma MCP server
        figma costs 300 tokens every turn and has never been called in 96
        sessions since it was configured.
      disable the sentry MCP server
        sentry costs 400 tokens every turn for 1 call in 96 sessions: 17,160,000
        tokens of standing cost per use.
      set the changelog-writer skill to off
        changelog-writer has not been invoked in 96 sessions here, by you or by
        the model.
      set the design-review skill to user-invocable-only
        design-review has only ever been typed as /design-review, never chosen
        by the model. This keeps the slash command and drops the description
        from the prompt.

      @@ -1,6 +1,17 @@
        {
          "permissions": {
      -     "allow": ["Bash(npm run test:*)", "Read(./src/**)"],
      +     "allow": [
      +       "Bash(npm run test:*)",
      +       "Read(./src/**)"
      +     ],
            "deny": []
      +   },
      +   "disabledMcpjsonServers": [
      +     "figma",
      +     "sentry"
      +   ],
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

    linear costs 300 tokens every turn for 3 calls, counted over every session
    on record because nothing says when it was added. It is declared in
    ~/.claude.json, which this tool does not write.
      claude mcp remove linear -s user

  700 tokens per turn recovered by the changes above.
```

Notice the fourth action. `design-review` is not switched off, it is demoted to
`user-invocable-only`: typing `/design-review` keeps working, and only the description leaves the
model's prompt. That costs you **zero** function, and a blunt on/off tool cannot express it, so it
tells you to delete something you use.

Notice the last line too. The two servers are the whole 700. The two skills add nothing to it here,
because this listing is over its budget: the room a skill gives up goes to a description that was
being dropped, not out of the prompt. That is the better outcome and a smaller number, and the
number printed is the one the change delivers.

And notice the `allow` array. Nothing asked for it to change, and the diff shows it anyway: `fix`
rewrites the whole file with two-space indentation, so an array you wrote on one line comes back
one element per line. It is the one change in the diff you did not ask for, and it is in the diff
so you see it before you say yes. The file is written with mode `0600`.

### 2. It asks

```
  Write this file? [y/N]
```

### 3. It writes, and tells you how to undo it

```
  Written.
    ~/projects/storefront/.claude/settings.local.json
      previous contents: ~/.cache/context-tax/b…ront-.claude-settings.local.json

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
| a skill | writes `off`, or `user-invocable-only` when you type it and the model never picks it |
| a claude.ai connector, or anything else no file declares | **says where it is switched off**, because there is no file here to edit |
| skills sent with no description | `--restore-descriptions` sets `skillListingBudgetFraction`, and only when you pass it |

### The rails on the write path

`fix` is a subcommand rather than a flag, on purpose. It is the only command that writes to your
settings, and it should not be reachable by adding one word to a command you ran for a report. (Two
other things write, and neither is a setting: `session --svg` writes the image file you name, and
every measuring command caches what your servers answered under `~/.cache/context-tax/`.)

- **Plans without touching your settings**, which is what makes `--dry-run` worth trusting. It still
  starts your servers to measure them, the same as the report does
- **Refuses to write when stdin is not a terminal** unless you pass `--yes`. A CLI that writes to a
  config file because it could not find anyone to ask is a CLI that writes to config files in CI
- **Backs up every file it replaces** to `~/.cache/context-tax/backups/`, directory `0700`, files `0600`
- **Writes temp-then-`rename`**, so an interrupted run leaves your old settings file intact
- **Never rewrites a settings file that does not parse.** A malformed one is usually a half-finished
  hand edit, and replacing it loses work. It is reported under `NOT TOUCHED` instead
- **Idempotent.** Run it twice and the second run says *already applied*
- **Never raises your per-turn cost unasked.** `--restore-descriptions` is the one change that adds
  tokens, so it is off unless you name it, it prints what it adds, and it never lowers a budget you
  have already set higher
- **Never touches `~/.claude.json`.** That file sits beside your API keys and bearer tokens. It is
  not rewritten and not backed up either, because a backup would be a second copy of every
  credential on your machine

<br>

## Commands and flags

```
context-tax             what your context costs and whether you used it   (default)
context-tax fix         execute the findings, after showing every changed line
context-tax receipt     the same totals with no names on them, to share
context-tax session     one session turn by turn: the climb, the compactions, the floor
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
| `--restore-descriptions` | `fix`: also raise the skill listing budget so every description is sent |
| `--svg <file>` | `session`: write the picture as an SVG |
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
| `evidence/` | What you called, and what was sent. Parses every local transcript for `tool_use` blocks and `usage`, machine-wide, so a directory with no history of its own still has a denominator. Reads the record a recent client keeps of what it put in the prompt, and keeps sizes and names, never the text | Exact, it is what you were billed and what was sent |
| `ledger/` | The multiplication, and a verdict per row | The join |

The rows come from the record when a session kept one. `measure` still runs, for two things the
record cannot say: the `deferred` column, which is the schemas a session never loaded, and any server
or machine with no recorded session to read.

To measure a server you have to start it. So every command that measures says what it started and
which hosts it contacted: `measure` in its report, and the report, `receipt` and `fix` on stderr as
they run. Schemas are cached for a week keyed on the **names** of your environment variables and
never their values, `${VAR}` and `${VAR:-default}` in a server definition are filled in the way
Claude Code fills them, and **no project server is started from a directory you are not standing
in**, since running one executes code from a repo you only pointed at. `--no-spawn` starts no
server at all; it still runs `git log` to date your config.

Starting them is also where the ten seconds goes, so a run tells you which server it is waiting on
while it waits. That line is written to stderr and only when stderr is a terminal, so `--json`,
`> file` and `| less` carry the report and nothing else.

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
<summary><b>The denominator covers everything the fix would switch off</b></summary>
<br>

`claude mcp remove <name> -s user` takes a server out of **every** project on the machine, so it is
never recommended on one project's silence: a server idle in this repo and busy in the one next door
is not dead, and that command would break work you are still doing. Machine-wide levers are judged
on machine-wide evidence, and project-scoped levers on this project's.

The rule has a ceiling as well as a floor: a denominator must not count sessions the thing could
never have been loaded in. A `.mcp.json` server exists in one project, so the machine's history is
not a wider window on the same question. A directory with too little history of its own therefore
borrows the machine's for what the machine loads everywhere, and says **no sessions yet, so there is
nothing to judge it on** for what it does not.

Whenever a count came from more than this directory, the row says **on this machine**. Silence means
the project, which is what every number here has always meant.

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
<summary><b>A skill is costed as what was sent, not as what is on disk</b></summary>
<br>

Claude Code caps the skill listing at 1% of the context window, in characters: 8,000 on a
200,000-token window, 40,000 on a million. Past that every skill keeps its name and descriptions
compete for what is left, so sixty skills of 1,000 characters each cost the budget that is sent, not
the 60,000 on disk. One large plugin is enough to be over.

The row is read from the listing your session sent, so it includes the client's own bundled skills,
which appear in no file. The window is not assumed either. It is worked back from that listing: the
budget has to sit between the size of what was sent and what the smallest dropped description would
have needed, and the window is that budget divided by your fraction. That is why the screen says
*about*. A listing that fits proves nothing about the window, so then no window is claimed and no
percentage is printed.

With no recorded session the row is modelled from the files on disk, and it says so: *modelled,
because no session here recorded its listing*, with the window it guessed and why.

Two things follow either way. Past the budget, switching a few skills off recovers close to nothing,
because the room goes to another description, so a saving here is always the listing before minus the
listing after. And only a skill with a lever counts as recoverable: a plugin skill in a plugin you
use has no switch, and a number promised for it is a number `fix` can never deliver. For skills, the
headline and the `fix` plan are the same figure for that reason.

</details>

<details>
<summary><b>One reply is counted once</b></summary>
<br>

Claude Code writes a single API reply as several transcript lines, one per content block, and each
line repeats the reply's `usage`. Counting lines counts a reply about twice. Every turn count, every
"tokens of context carried" and every per-call figure is taken once per reply id. Versions before
0.4.0 counted lines, so their turn and per-call figures ran at about twice the truth.

</details>

<details>
<summary><b>A server that did not connect is not charged</b></summary>
<br>

A server in your config that the session could not reach sent nothing, so its row is `0` and says
*could not connect*, with what it weighs when it does start. It gets no finding: there is nothing to
recover from a server that costs nothing, and the useful news is that it is broken. A server added
after the recorded session began is weighed instead, because that session could not have sent it.

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
- **It reads every transcript under `~/.claude/projects`, and none of it leaves.** The whole corpus
  is read so a project with no history of its own can still be given a denominator. It is a local
  read of files you already have: nothing is uploaded, cached off-machine or written back.
- **What was sent is measured, not kept.** The transcript record holds the full text of your
  instruction files and skill descriptions. The parser takes lengths, counts and names from it and
  drops the text on the same line, so none of the text a session sent reaches the report, `--json`,
  or the library API. A test asserts that. (The descriptions of the skills and agents on your disk
  are read as files, and `config --json` carries those.)
- **The receipt and the session image carry no names.** Not a server, plugin, skill, path, project or
  session id. They are the two screens made to be posted, and both are pinned by a test.
- **No model call.** Every verdict is arithmetic.
- **Credentials go to the server they belong to, and nowhere else.** A server's `env`, headers and
  arguments are handed to that server to start it, never printed, and never cached: schema caching
  is keyed on the *names* of environment variables, a URL is printed as its scheme and host, and a
  failing server's output is scrubbed of every value it was given. `~/.claude.json` is never
  written or backed up.
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
// Starts the servers in the config, the same handshake your agent performs. The CLI refuses to
// start a project's servers from a directory you are not standing in; the library leaves that to
// you, so pass `trustProjectServers: false` when `cwd` is somewhere you only pointed at.
const measured = await measureContext(resolved);

const ledger = buildLedger(resolved, measured, evidence);

for (const finding of ledger.findings) {
  console.log(finding.headline, '→', finding.saves ?? 'unknown', 'tokens/turn');
}
```

`planFixes` and `applyFixes` are exported too, so the write path is available without the CLI. So
are the two shareable screens and the series behind the picture:

```ts
import { readSessionSeries, renderSessionSvg, renderReceipt, palette } from 'context-tax';

const series = await readSessionSeries(pathToOneTranscript);
const svg = renderSessionSvg({ series, openedAt: null });
const receipt = renderReceipt(ledger, palette(false), '2026-09-02');
```

`evidence.sessions[n].record` is what that session sent, as sizes, counts and names. The text it was
measured on is never on it.

> [!WARNING]
> `resolveConfig` returns `{ config, launch }`. Only `config` is safe to serialize. `launch` holds
> the command lines, environment values and bearer tokens a spawn needs, and it is a `Map`
> precisely so that `JSON.stringify` on the whole result emits `{}` for it.

<br>

## FAQ

<details>
<summary><b>Does this work with anything other than Claude Code?</b></summary>
<br>

No. The `resolve` and `evidence` passes read Claude Code's config chain and transcript format. The
`measure` pass is plain MCP and client-agnostic, so a reader for another client is mostly a second
`resolve` and `evidence` pass. If you use one, open an issue with its config and log layout.

</details>

<details>
<summary><b>Will it break my setup?</b></summary>
<br>

Only `fix` writes to your settings, only after showing you the diff and asking, and it copies every
file it replaces to `~/.cache/context-tax/backups/` first. Restoring is a `cp`. It will not touch
`~/.claude.json` at all.

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

With a recent Claude Code it should not be. The client's own tools and system prompt used to live in
this row, and they are now itemised under `CLAUDE CODE ITSELF`, read from what the session sent. What
is left is the gap between text measured in characters and tokens billed, plus anything the client
sends without recording it.

On a machine whose sessions predate that record it is still large, because it still holds the system
prompt and the built-in tool schemas. Those are real tokens you pay, and it would be easy to hide
them by only totalling the rows. They are shown so the percentages mean something.

</details>

<br>

## Development

```bash
npm install
npm run typecheck    # tsc --noEmit, strict
npm run lint         # eslint, no-explicit-any is an error
npm test             # vitest
npm run build
```

Every guard in this package has been **mutation-checked**: the bug is put back and the test has to
fail. A test that has never been seen to fail is not evidence of anything.

Three of the bugs found that way were confident zeroes that looked entirely plausible on screen, and
each was found by running the tool against real projects rather than by reading it. One is worth
repeating as a rule, because it is the trap this whole category of tool falls into: **a finding the
tool cannot defend line by line is a bug in the tool.**

Contributions are welcome. See [CONTRIBUTING.md](https://github.com/gethrbr/context-tax/blob/main/CONTRIBUTING.md).

<br>

---

<div align="center">

[MIT](./LICENSE) · [Report an issue](https://github.com/gethrbr/context-tax/issues) · [Changelog](https://github.com/gethrbr/context-tax/blob/main/CHANGELOG.md)

<sub>Built by the team behind [Harbor](https://gethrbr.com), a shared brain for your team's agents.</sub>

</div>
