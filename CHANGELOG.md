# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

An audit of the published package, run against fabricated machines that look nothing like the one
it was built on. Nothing here changes what the tool is for; everything here is a way it could have
been wrong, rude, or loud on somebody else's machine.

### Fixed

- 🚨 **An MCP server whose `url` is not a URL no longer ends every report with a stack trace.** A
  `${API_BASE}` the environment did not fill, an empty `url`, or a host with no scheme made the
  measuring step throw `TypeError: Invalid URL` out of the whole run. It is now a row that says the
  URL could not be parsed, naming the placeholder that was not set, never the URL itself.

- 🚨 **`${VAR}` and `${VAR:-default}` in a server definition are filled in**, in `command`, `args`,
  `env`, `url` and `headers`, the way Claude Code fills them before it starts the server. Such a
  server used to be probed with the placeholder left in and reported as one that could not start.

- 🚨 **A small skill listing with one bare name no longer proves a window.** A 465-character list
  with a skill the tool could not size was read as a list pinned against its budget, which derived
  "a window of about 12,000" and put "292% of a window" on the first line and on the receipt. The
  smallest window the client runs is 200,000 tokens, so a list under that window's share of the
  budget was never cut, and its bare names are skills with nothing to say.

- 🚨 **The first-request number is the first billed request.** The rule was "the first request
  that read nothing from cache", which skipped every session whose first call was a cache hit and,
  when the cache expired mid-session, took a turn carrying the whole conversation as the session's
  opening size, at two to five times the truth. The usage total of the first call is the whole
  prompt whether the cache served it or not, so that is the number now. On the machine this was
  found on, the ten-session median moved by 0.2%. The screen says *first request* where it said
  *cold start*.

- 🔒 **A URL is printed as its scheme and host.** The path was kept, and hosted MCP gateways put
  the secret in the path, so `config --json` could carry it. A server started as its own executable
  no longer has its first argument printed as the entry either, since that can be a token; only
  what a runner (`npx`, `uvx`, `node`, ...) was told to run is shown.

- 🔒 **A failing server's echo is scrubbed of its arguments too**, not only of its `env` and
  header values. `npx mcp-remote <url> --header "Authorization: Bearer …"` is a common shape, and a
  launcher that fails prints its own argv to stderr, which becomes the row's reason on screen.

- 🔒 **A malformed settings or `.mcp.json` file is reported by position**, not by quoting the ten
  characters around the bad token, which in a settings file are as likely as not beside a key.

- 🔒 **A failed remote probe never quotes the URL back.** Node's `fetch` refuses a URL that carries
  credentials by printing the whole URL in its error; that message now carries the scheme and host.

- **`session --svg` into a directory that does not exist is an error message**, not an uncaught
  `ENOENT` with a stack trace. `--svg` with `--json` says it is ignored.

- **`fix --yes` into a `.claude/` it cannot write is one sentence**, naming the file and the reason
  in words, and it happens before anything is copied: the new text is written beside the target
  first, then the backup, then the rename, so a read-only directory leaves no stray backup and no
  temp file. When a later file fails, the ones already written are reported as written, with their
  backups. It was an uncaught `EACCES` with a stack trace, after the backup had been made.

- **The receipt says so when its rows sum past the total, and exits 1 like the main screen.** A
  listing read from a session newer than the ones the total is billed from can outrun it; the main
  screen refused that sum in red and the receipt, the screen built to be shared, printed the rows
  and the smaller total, said nothing, and exited 0.

- **A settings file that starts with a byte-order mark is read.** JSON.parse rejects the mark a
  Windows editor leaves, and rejecting the file dropped every server it declared from every view.

- **`--top` and `--window` are whole numbers, and `--cwd` cannot be empty.** `--window 0.5` was
  accepted and drew an empty window over a machine with a real first request; `--cwd ""` matched
  every session on the machine under a blank title. A sub-second `--timeout` now says
  `within 250ms`, not `within 0s`.

- Grammar: `evidence` said "1 sessions" and "1 malformed lines", `config` said "a file under them
  are touched", and a session with no timestamp printed the window as " to 2026-09-10".

- **The MCP handshake introduces this tool with its real version.** `clientInfo` said `0.1.0` on
  every install since 0.1.0; it now reads the manifest, the same as `--version`.

- **The report, `receipt` and `fix` say what they started.** `measure` always listed the hosts it
  contacted; the commands everyone actually runs started the same servers and named nothing. On a
  terminal they now leave one line under the spinner: what was started, and which hosts were
  contacted, or that it was nothing.

- The receipt's `PAID` block is `SO FAR`: it sits over turns and over tokens carried, and only the
  first of those was paid for as such.

### Documentation

- The `fix` screens in the README were hand-written and had drifted: the diff header, every
  sentence under an action, and a backup path of a shape the tool never writes. They are generated
  from a fixture and pinned by a test now, like the other screens, and the diff shows what a rewrite
  does to an inline array. The README's `linear` example carries the unknown-age caveat the code
  prints for a `~/.claude.json` server.
- "`fix` is the only part of this package that writes" was false as written: `session --svg`
  writes the file you name, and every measuring command writes the schema cache. It now says
  "the only command that writes to your settings", in the README and in `--help`.
- The library example did not typecheck (`measureContext` takes no `cwd`), and it now says that
  the "not from a directory you are not standing in" rule is the CLI's, with `trustProjectServers`
  as the library's switch.
- Two README links pointed at files that are not in the tarball and 404 on npmjs.com.
- Comments that ship in `dist/` no longer refer to a private plan by section number, name the
  machine the tool was built on or its plugins, cite a flag that does not exist, or call the
  tokenizer ratio provisional when it was measured within 4%.

## 0.4.0

**The rows are read, not modelled.** A recent Claude Code writes what it sent into the session
transcript: the skill listing as it went out, the tool names, each instruction file, its own tools
and system prompt. Until now this tool worked all of that out from your config and hoped the client
agreed. It now reads the record, and keeps the model for machines that have none.

Reading it turned up two things that are bigger than the feature. Every turn count this tool has
ever printed was about double. And on a config with one large plugin, most skills reach the model as
a name with nothing to choose them by, which no screen anywhere says.

### Added

- **Rows come from what a session sent.** Skills, agents, instruction files, MCP servers, your
  hooks, and the client's own tools, system prompt, tool name list and session details are each
  measured on the text the transcript recorded. A line under the table names the session they were
  read from. With no such session the rows are weighed from your config as before, and the same
  line says that. A server added after the recorded session began is weighed too, because that
  session could not have sent it.

- **`CLAUDE CODE ITSELF` is itemised.** The client's built-in tools and system prompt were the bulk
  of `unattributed`. They are rows now, under a title that says whose they are, so the remainder is
  the gap between characters and billed tokens rather than most of the screen.

- **What your agent never received.** Past its budget the client sends a skill as a bare name. The
  first finding counts those from the listing itself, groups them by who owns them, and prices the
  two ways out: raise `skillListingBudgetFraction` and pay for every description, or switch skills
  off and hand their room on. It is a count, not an estimate, and it says which session it is from
  and that who loses out shifts with recent use.

- **The window is worked out, not assumed.** The budget has to sit between the size of the listing
  that was sent and what the smallest dropped description would have needed, and the window is that
  budget divided by your fraction. The screen says *about*. A listing that fits proves nothing about
  the window, so then no window is claimed.

- **The first line says the share of the window**: *N tokens on every turn, P% of a window of about
  W, before you type a word.* Only when a session proves the window. Otherwise there is no
  percentage at all.

- **`context-tax receipt`.** The same totals by kind, 46 columns wide, with no server, plugin,
  skill or path on it, made to be screenshotted.

- **`context-tax session`, and `--svg <file>`.** One session turn by turn: the climb, each
  compaction, and the floor it never drops under, which is the prefix the main screen itemises. The
  SVG is one self-contained file carrying numbers and nothing else.

- **`context-tax fix --restore-descriptions`** sets `skillListingBudgetFraction` to what sends every
  description. It is never part of a plain `fix`, because it is the one change here that makes every
  turn cost more. It prints what it adds, and it never lowers a fraction you have already set higher.

- **Connectors no file declares are rows.** A claude.ai account connector, or a server built into
  the client, is in the record and in no config. It is listed with its calls, judged on the machine's
  history, and its finding says where it is switched off, since there is nothing here to edit.
  Connectors under 100 tokens are grouped into one row.

- On the library export: `record` and `headless` on each session in `evidence`; `source`,
  `windowTokens`, `listingBudget` and `neverReceived` on the ledger; `count` and `part` on a row; a
  `not-sent` verdict; `readSessionSeries`, `summarize`, `downsample`, `renderReceipt`,
  `renderSession`, `renderSessionSvg`, `sessionCaption`, `parseSkillListing`, `transcriptKeysFor`
  and `toolPrefixName`.

### Fixed

- 🚨 **One reply is counted once.** Claude Code writes a single API reply as several transcript
  lines, one per content block, and every line repeats the reply's `usage`. The scan counted lines.
  A reply with a thought, a sentence and a tool call is three lines, so turns, *tokens of context
  carried*, and every *per call* and *standing cost per use* figure ran at about twice the truth.
  Usage is now taken once per reply id. `tool_use` blocks are still read from every line, so call
  counts do not move. **Every one of those figures drops on upgrade, and the new ones are right.**

- 🚨 **A plugin's server is no longer reported as never called.** The client keys its tools
  `mcp__plugin_<plugin>_<server>__`, and the join looked for `mcp__<server>__`, found nothing, and
  said *0 calls* about a server in daily use. A name with a space or a dot in it missed the same
  way, because the client replaces those characters in the tool prefix. Calls are now summed over
  every key a server can appear under.

- **A server that could not connect is not charged.** It sent nothing, so its row is `0` and says
  *could not connect*, with what it weighs when it does start. It gets no finding: there is nothing
  to recover from a server that costs nothing.

- **A server's per-turn cost is what a deferring client sends**: its tool names and its
  instructions. The weighed figure also counted every tool description, which the client no longer
  puts in the prompt, so server rows ran high.

- **A server declared in two places and loaded under two names is one row**, carrying both copies.

- **`claude -p` and SDK runs are not read as your session.** They load a different prefix, so an
  interactive session is preferred for the total and for the record, and a headless one is used only
  when there is nothing else.

- **`config` and `measure` say which screen to believe.** Both work from files and assume a
  200,000-token window for the listing cap. They now say so, and point at the main screen, which
  reads what was sent.

The rest of this list is the model, which is now the fallback for a machine with no recorded
session. It was the first thing found in this release: **a skill was costed as what is on disk, and
the client does not send what is on disk.**

- **The skills row is what the listing costs as Claude Code packs it.** Every skill's `name` and
  `description` was summed, whole, with no cap. The client cuts one description at 1,536 characters
  and caps the entire listing at 1% of the context window: 8,000 characters on a 200,000-token window,
  40,000 on a million.
  Past that every skill keeps its name and descriptions compete for what is left. Sixty skills of
  1,000 characters each were reported as 60,000 characters on every turn where the model is sent
  8,000, and a config carrying one large plugin is that shape. The packing is reproduced step for
  step in `measure/skill-listing.ts`, and an on/off run of a plugin against billed `usage` is how
  it was checked.

- **A saving is the listing before minus the listing after, never a sum of lines.** Past the budget
  the client hands freed room to another description, so switching off three skills out of sixty
  recovers close to nothing, and the old sum promised all three. Findings are charged in order
  against one shrinking listing, so they add up, and the finding says when the listing is over its
  budget, first in its detail where the four-line clamp cannot cut it.

- **The headline, the findings and the `fix` plan say the same number.** Only a skill with a lever
  leaves the listing: a plugin skill in a plugin you use has no switch, so it is no longer counted
  as recoverable. Before this the front screen could promise several times what `fix` went on to
  write. A joint saving is split across its actions by weight in whole tokens that sum exactly.

- **A skill the model is never told about costs nothing.** `skillOverrides` of `off` and
  `user-invocable-only`, and `disable-model-invocation: true` in the frontmatter, were all still
  counted and still recommended for switching off, including on the run after `fix` had done it.
  `name-only` is costed as its name. An override on a plugin skill is ignored, as the client
  ignores it.

- **`when_to_use` is part of the line**, joined to the description the way the client joins it, and
  a plugin skill is costed under its `plugin:name`, which is how it is listed.

- **A plugin you use is handed back once, not once per skill.** It has no per-skill switch, and
  that is one fact about the plugin. It was printed once for each unused skill, so a plugin with a
  hundred of them put a hundred copies of one sentence in the `fix` plan, with the edits `fix` does
  make somewhere underneath. The note now carries the count, and it is one line per plugin however
  many findings reach it.

- **The `fix:` line under a skills finding is routed the way its actions are.** It told you to set
  every skill to `off` in `skillOverrides`, including plugin skills, where that entry does nothing.
  A plugin skill you type was pointed at `enabledPlugins`, which would have taken the slash command
  away: typing it is what makes the plugin one you use. The line is now built from the kinds of
  skill actually in the finding.

- **`config` prints what the listing sends.** It summed the characters on disk, the number the
  ledger had stopped believing, one command away from it, and counted a skill as "listed to the
  model" on the same line that called it hidden.

- 🚨 **A server this tool cannot start is only called broken when your sessions agree.** A remote
  server behind a login answers the client, which holds the token, and answers this tool with a
  401. It was reported as `cannot start, so it gives your sessions nothing`, beside a calls column
  that said otherwise. The transcripts are the exact half of the evidence, so a server with calls
  on record is now `not measured`, with the reason, and only one with none is broken.

- **Nothing is said about a server that costs nothing.** One that exposes no tools weighs zero and
  cannot be called, and it was still given a finding: `costs 0 tokens every turn and has never
  been called`.

- The window the modelled budget is a share of is a guess from how large your turns have run: a turn
  that carried more than 200,000 tokens was not inside a 200,000-token window. That proves the
  window was larger and not how large, so a row built on it says it is modelled, and no percentage
  is printed from it.
- `skillListingBudgetFraction`, `skillListingMaxDescChars` and `SLASH_COMMAND_TOOL_CHAR_BUDGET`
  are read from the settings chain and the environment. One named key is read out of a settings
  `env` block and nothing else in it.
- `peakContextTokens` on each session in `evidence`, and the packing functions on the library
  export.

### What it still cannot see

The record exists only in transcripts written by a recent client. On an older one every row falls
back to the model and says so. There, Claude Code's own bundled skills sit in the same budget and
appear in no file, so the modelled skills row is a **ceiling**.

With a record the bundled skills are in the listing that is read, so the row is what was sent. What
is still not claimed is which skill loses its description next time. The client fills the room in
order of recent use, so the finding names who lost out in the session it read, and says that shifts.

A hook that adds context on every prompt is counted once, as what it put in front of the first turn.

## 0.3.1

No behaviour change, and one reason to cut it: `0.3.0` shipped two figures measured on a real
machine. `tsc` keeps comments, so they reached `dist/` and therefore the published tarball, not just
the repository, where a `grep` over `node_modules` found them on any machine that installed it.

### Fixed

- **No count from a developer's machine in anything that ships.** The audit that produced `0.3.0`
  quoted its own reproduction, and two of the figures in it were real rather than fixture: a session
  count, and a tally of `Agent` invocations against zero `Task`. A tool whose whole argument is that
  nothing leaves your machine should not ship a count taken off one, however harmless the integer,
  and `CONTRIBUTING.md` already says examples come from a fabricated fixture through the real
  renderers. The replacement reproduces the same bug from a corpus that is nobody's history: twelve
  sessions, every one of them belonging to another directory. The `Task` note now states what is
  true of any corpus rather than what was true of one.

  Comments only, which is why this is a patch: no behaviour, no API surface and no output changed.

### Changed

- `vitest` `3.2.7` to `5.0.0`, a development dependency that is not in the tarball. It collects and
  runs the same 267 tests across the same 12 files on Node 20, 22 and 24. The lockfile's platform
  binaries move off `@rollup/rollup-*` to rolldown and lightningcss, with no family losing an entry.

## 0.3.0

Nine defects, found by auditing the published `0.2.1` against configurations nobody here designed:
a directory with no history, a machine two sessions old, a transcript that cannot be opened, a
server that cannot start, and twelve servers at once with four of them pathological. Every one of
them is the same shape, which is why they are one release: **the tool said something it could not
defend, in a place where saying nothing was available.**

### Fixed

- 🚨 **A verdict no longer counts sessions the thing could never have been loaded in.** `0.2.0`
  established that a denominator must cover everything its fix would switch off. It had no ceiling,
  so a project with too little history of its own borrowed the machine's for *everything*,
  including servers that exist in one directory. Measured against the published `0.2.1`, in a
  directory that had never run Claude Code, against a `.mcp.json` committed a year earlier, with a
  fabricated corpus whose every session belongs to another directory:

  ```
  everything costs 740 tokens every turn and has never been called
  0 calls in 12 sessions on this machine since it was configured.
  ```

  It was in context for none of those 12 sessions, a real corpus puts hundreds in that sentence, and
  the fix offered would have switched off a server that never had a chance to be called. The window
  was real and it was a window on something else. Widening is now earned by **reach** rather than by
  need: a `-s user` server and a plugin the machine enabled are loaded in every session, so their
  silence everywhere is evidence, while a `.mcp.json` server, a `~/.claude.json` entry filed under
  one project, and a plugin this repo enabled are judged here or not at all. The same rule now
  applies per skill. Where nothing can be judged the row says *no sessions yet, so there is nothing
  to go on*, which is what the tool actually knows. See `ledger/reach.ts`.

- 🚨 **A server that failed to start is no longer priced from the bundled table.** The failure path
  reached for the fallback table before giving up, so a server whose package was one of the five in
  that table came back at 1,078 tokens a turn from a measurement of somebody else's working copy,
  while the `cannot start` finding and the spawn error behind it were both dropped. Whether a
  broken server was reported at all depended on whether its package happened to be in a table. The
  table answers *what would this have cost*, which is the wrong question about a server that just
  refused to run. `--no-spawn`, which never asked, still uses it.

- 🚨 **One unreadable transcript no longer takes the whole run down.** A corrupt line was always
  data rather than an exception; a corrupt file was not, and a single `EACCES` ended the run with a
  Node stack trace and exit 1. Every way it happens is ordinary: a session file written under
  `sudo` is root-owned, a live session can remove a file between the listing and the open, and a
  network home can drop a read. The scan now finishes and names what it could not read, because
  every session inside those files is missing from every denominator on the screen.

- 🚨 **`N skills never invoked` now needs the same five sessions a server has always needed.** On a
  machine two sessions old it was reachable, and it is not a finding there, it is a description of
  a machine two sessions old. It arrived with a `--fix` that writes settings.

- 🚨 **A screen where nothing could be judged no longer reads as an all-clear.** Zero findings has
  two causes and they are opposites: everything here is earning its place, or nothing here could be
  judged at all. The headline said *nothing on this screen is unused* for both, one line above a
  table saying *too few to judge*.

- **An agent invoked under the tool's older name is counted.** The subagent tool was `Task` before
  it was renamed `Agent`, and a transcript is history: a machine with a year of sessions has both
  on disk. Only the current name was read, and an agent that looks uninvoked is what makes its
  whole plugin look idle, which is the one lever that switches off a plugin's servers, skills,
  agents and commands together. A corpus that begins after the rename holds nothing but `Agent`,
  which is why a machine with only recent history cannot surface this and an older one is full of
  it.

- **The calls column takes a dash where there is no history to count.** `0` is a measurement, and
  beside a note reading *no sessions yet* it was a measurement of nothing. `share` and `per call`
  already went to a dash for the same reason.

- **Two verdicts stop counting to zero out loud.** *only 0 sessions since it was configured* and
  *0 calls in 0 sessions on record* are arithmetic where a sentence belongs, and the reader most
  likely to see either is standing in a directory they have never used Claude Code in. Neither
  carries a pronoun, because identical notes are merged and one sentence has to read as well for
  eight servers as for one.

- **`--fix` no longer points at a backup of a file that did not exist.** A first fix usually
  creates the settings file it writes to, and nothing was backed up because there was nothing to
  back up. *Restore any of them by copying the backup back over the file* was then an instruction
  that could not be followed, printed at the one moment the reader most needs it to be true.

### Changed

- `Ledger` gains `judged` and `Evidence` gains `unreadable`, both required. Consumers of the
  library surface that construct either type by hand will need the new fields, which is why this is
  a minor rather than a patch.

## 0.2.1

### Fixed

- 🚨 **`--cwd` no longer runs a repository's servers because it happens to sit under the one you
  are standing in.** Starting a project server executes whatever that repo's `.mcp.json` names, so
  the rule has always been that standing in the directory is consent and a flag is not. The check
  asked a looser question — is either path inside the other — and read `cd ~/projects &&
  context-tax --cwd ./just-cloned` as the monorepo case, because the target was underneath the
  working directory. Found by pointing 0.2.0 at seven freshly cloned repositories: one declared
  `uvx arxiv-mcp-server` and the run tried to start it, thirty seconds after `git clone`. Trust is
  now anchored on the project root the servers were resolved for, which keeps every real monorepo
  case working — pointing up at the root from a package, or down at a package from the root — and
  refuses a nested checkout, which is its own project and never yours. The rule moved into
  `trust.ts` so that it can be tested at all: it lived in `index.ts`, which dispatches at module
  scope and therefore cannot be imported by a test.

- **A fix no longer names a file you cannot open.** The line telling you which settings file to
  edit was clamped at three lines like the diagnostic prose above it, so a long path lost its tail
  to an `…` — the actionable half of the one actionable line. The path is now printed whole,
  `$HOME` is collapsed to `~` so the usual one fits on a single line, and a path too long even for
  that starts on its own line instead of trailing off the end of a sentence.

- **`1 memory files`.** A row that counts to one now says so.

## 0.2.0

### Added

- **A progress line, because a run takes about ten seconds and every one of them was silent.** The
  first byte of output used to be the finished report, so `npx context-tax` looked like a hang, and
  the natural response to a hang is ctrl-C — which guarantees the reader never sees what the tool
  does. It names the server it is waiting on rather than just spinning, which is also the clearest
  possible evidence of the claim the tool rests on: it really does start your servers and perform
  the handshake.

  🔒 It writes to **stderr only, and only when stderr is a TTY**, so `--json`, `> file` and
  `| less` are byte-for-byte what they were. Asserted at the import graph, not by eye: in a
  terminal both streams land in the same window and a spinner on stdout looks perfectly fine right
  up until somebody pipes the report somewhere.

### Fixed

- 🚨 **A machine-wide removal is no longer recommended on one project's silence.** A server whose
  only lever is `claude mcp remove <name> -s user` was judged on the sessions in the current
  directory tree, so a server idle here and busy in a sibling checkout was reported as barely used
  and handed you a command that would have taken it out of both. Found on a real machine: one call
  here, sixty-seven next door, and the removal printed anyway. A verdict's denominator now has to
  cover everything its fix would switch off.

### Changed

- **The evidence pass reads the whole machine, not the current directory tree.** In a fresh clone,
  or any directory you have not used Claude Code in, `share`, `calls` and `per call` all came out
  empty and every verdict downgraded to "too few sessions to judge" — the three columns that carry
  the argument, blank in the run a new reader is most likely to make first, while the history to
  fill them sat on the same disk. A project with too little history now borrows the machine's
  denominator and says `on this machine` wherever it did. The exact total does **not** widen: a
  cold-start median mixed across projects with different configs is not this directory's prefix,
  and it would be the one number on the screen that is not exact.

  The scan was scoped to the tree on the stated grounds that a whole-corpus pass costs a minute.
  Measured: 890 transcripts and 2.1 GB in 5.1s, inside a command that already spends ten seconds
  starting MCP servers.

- **The screen leads with the number instead of the method.** The report opened with four lines of
  `chars/4` caveat before a single figure and kept its one exact number at the bottom of the table.
  The headline now sits above the table and the methodology below it, next to the total it
  qualifies. Nothing was removed.

- **A line saying what this machine has actually spent**: sessions, turns, tokens of context
  carried, and the `/clear` and `/compact` you typed. All of it was already computed and reachable
  only through `context-tax evidence`, a subcommand documented as a development view.

- Rows sharing a note are collapsed onto one line instead of repeating the same sentence.

- A row measured from the bundled fallback table now says so on the main screen. It printed the
  same bare dash as a row that could not be measured at all, and only `context-tax measure` told
  you which.

### Notes

- `MeasureOptions` gained an optional `onProbe` notification. Nothing waits on it and nothing
  branches on it; a caller that omits it gets byte-identical results.
- The library surface changed: `Verdict` carries a required `scope`, `LedgerRow` a `basis`, and
  `Ledger` a `machine`.
- The README's screens are now regenerated from a fabricated fixture through the real renderer and
  pinned by a test, so the claim that they cannot drift from the code is enforced rather than made.

## 0.1.1

### Fixed

- A run that finds nothing now says so, instead of drawing a grid with `0` or `-` in every cell. In
  a directory with no MCP servers, skills, agents or memory files, and no session history to join
  them against, the whole table was printed anyway, and an empty table reads as a tool that failed
  rather than as a machine with nothing on it. That was the run a new reader was most likely to make
  first.

### Notes

- The new screen is deliberately narrow in what it claims. A `null` token count still prints the
  table, because `null` means an item could not be measured, which is a real cost of unknown size
  rather than an absence. A machine with sessions on record but nothing loaded also keeps the full
  screen, because it still has a billed total to reconcile against.
- `PROBLEMS` is reported on both paths. A file that could not be read is news whether or not
  anything else was found.

## 0.1.0

First public release.

### Added

- `context-tax`, the default command: what your context costs per turn, joined against what your
  sessions actually called, with a verdict and a routed fix per row.
- `context-tax fix`, the only command that writes. Plans without touching disk, shows a real diff of
  the bytes it will land, backs up what it replaces to `~/.cache/context-tax/backups/`, and refuses
  to write from a non-interactive stdin unless `--yes` is passed.
- `context-tax config`, `measure` and `evidence` for the three passes on their own.
- A library surface on `main`, so every pass is usable without the terminal rendering.
- `deferred` as its own column, because current Claude Code loads MCP tool schemas on demand rather
  than carrying them in every prompt, and collapsing the two costs into one number would misreport
  one of them.

### Requires

- Node 20 or newer. The package's own code runs on 18, but the test toolchain does not, and a
  supported version that cannot be tested is not a supported version. Node 18 reached end of life in
  April 2025.

### Notes

- Token counts are `chars / 4`, checked by execution to within 4%.
- No dollar figure is printed, because a price is the one input that cannot be read off the machine.
- Zero runtime dependencies, asserted against the import graph rather than the manifest.
