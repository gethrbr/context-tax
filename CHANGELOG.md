# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
