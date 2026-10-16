# broken-import

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

@import names a file that does not exist.

An `@path` import in a CLAUDE.md, a `.claude/rules/` file, a GEMINI.md, or an AGENTS.md that Claude Code reads directly, where the file does not exist. The import is silent: Claude Code and Gemini CLI load what they can find and say nothing about the rest. A token that looks like an npm package (`@scope/name`, one slash, no extension) is a note with a hint, because it is far more often a package name than a file, and in a heading (`# @scope/name`) it is not reported at all. Closing quotes and punctuation are not part of the token, and an `@name` inside double quotes (`"Thanks @user"`) is a mention, not an import.

## Why it matters

Claude Code and Gemini CLI load imported files with the instructions. A missing file means the instructions are silently incomplete.

## Bad example

```markdown
@AGENTS.md
@docs/conventions.md
@docs/missing-guide.md
```
`docs/missing-guide.md` was renamed to `docs/contributing.md` last quarter. The team believes the contributing rules are loaded in every session; they have not been since the rename.

## Good example

```markdown
@AGENTS.md
@docs/conventions.md
@docs/contributing.md

We use `@tanstack/query` for data fetching.
```
The package name is in backticks, so it is not read as an import.

## How to fix

Correct the path (relative to the file that contains the import) or remove the line. Wrap package names and handles in backticks when they start a line.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line broken-import -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file broken-import -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "broken-import": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/broken-import.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
