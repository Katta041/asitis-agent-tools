# orphan-memory

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | several files or the folder layout | no | yes |

## What it catches

Memory topic file is not linked from MEMORY.md.

A memory topic file in a folder with a `MEMORY.md` that does not link to it. Claude Code loads the index at session start and reads topic files only by following links from it, so an unlinked file is never read. Only runs when the whole folder is linted.

## Why it matters

Claude Code reads topic files through the index, so an unlinked file never loads.

## Bad example

```text
memory/
  MEMORY.md
  debugging.md
```
```markdown
<!-- MEMORY.md -->
# Memory index

- [Release process](release.md): tags, changelog, npm publish steps
```
`debugging.md` holds the notes about the flaky integration test, and nothing points at it.

## Good example

```markdown
# Memory index

- [Release process](release.md): tags, changelog, npm publish steps
- [Debugging notes](debugging.md): the flaky integration test and how to reproduce it
```

## How to fix

Add one line to `MEMORY.md` with a link to the file and a few words on when it matters, or delete the file if the notes are stale.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line orphan-memory -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file orphan-memory -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "orphan-memory": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/orphan-memory.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
