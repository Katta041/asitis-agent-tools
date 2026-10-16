# import-outside-root

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

@import reaches outside the project.

An `@path` import that reaches outside the project: a home-folder path such as `@~/.claude/prefs.md`, or a relative path that climbs above the root.

## Why it matters

Claude Code asks for approval before loading external imports, and teammates will not have the file.

## Bad example

```markdown
# CLAUDE.md

@~/.claude/my-preferences.md
```
Claude Code treats an import outside the working directory as external and shows an approval dialog the first time; if the person declines, the import stays off. Teammates do not have the file at all, so the project instructions differ from one machine to the next.

## Good example

```markdown
# CLAUDE.md

@docs/conventions.md
```
Personal preferences go in `~/.claude/CLAUDE.md`, which loads for every project without a dialog, or in `CLAUDE.local.md`, which is gitignored.

## How to fix

Move the imported content into the repository, or move the import to a user-scope file (`~/.claude/CLAUDE.md`, `~/.claude/rules/`) where external imports are trusted as your own configuration.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line import-outside-root -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file import-outside-root -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "import-outside-root": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/import-outside-root.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
