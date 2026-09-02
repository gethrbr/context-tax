# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
