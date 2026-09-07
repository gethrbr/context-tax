# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  directory that had never run Claude Code, against a `.mcp.json` committed a year earlier:

  ```
  everything costs 740 tokens every turn and has never been called
  0 calls in 746 sessions on this machine since it was configured.
  ```

  It was in context for none of those 746 sessions, and the fix offered would have switched off a
  server that never had a chance to be called. The window was real and it was a window on something
  else. Widening is now earned by **reach** rather than by need: a `-s user` server and a plugin
  the machine enabled are loaded in every session, so their silence everywhere is evidence, while a
  `.mcp.json` server, a `~/.claude.json` entry filed under one project, and a plugin this repo
  enabled are judged here or not at all. The same rule now applies per skill. Where nothing can be
  judged the row says *no sessions yet, so there is nothing to go on*, which is what the tool
  actually knows. See `ledger/reach.ts`.

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
  agents and commands together. This machine has 109 `Agent` and zero `Task`, which is what a
  corpus that begins after the rename looks like, and why no run here could have caught it.

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
