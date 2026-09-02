# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/gethrbr/context-tax/security/advisories/new).

You should get a first response within 72 hours. If a fix is warranted, the advisory is published
alongside the release that carries it, with credit unless you ask otherwise.

## Supported versions

The latest published minor release is supported. This package is pre-1.0, so fixes land forward
rather than being backported.

## What this package touches

Useful context when judging whether something is a vulnerability here:

- **It reads local files**: your Claude Code settings chain, `.mcp.json`, `~/.claude.json`, plugin
  manifests, skill and agent frontmatter, memory files, and session transcripts under
  `~/.claude/projects/`.
- **It starts the MCP servers already in your config**, in order to ask them the same `tools/list`
  question your agent asks. That is the only outbound network activity, and every host it speaks to
  is printed. It will not start a project server from a directory you are not standing in.
- **It writes to exactly one place**: settings JSON files, and only under the `fix` subcommand,
  after showing a diff and asking. Replaced files are copied to `~/.cache/context-tax/backups/`
  (`0700` directory, `0600` files).
- **It never writes or backs up `~/.claude.json`**, which holds live API keys and bearer tokens.
- **It caches measured schemas** keyed on the *names* of a server's environment variables, never
  their values.
- **It has zero runtime dependencies**, asserted against the import graph by the test suite and
  again in CI.

Reports that would be especially valuable: a path where credential values reach the cache, a
settings write that escapes the intended file, a crafted transcript or settings file that causes
code execution, or a way to make `fix` write without a confirmation.
