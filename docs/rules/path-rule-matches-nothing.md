# path-rule-matches-nothing

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| drift | warning | several files or the folder layout | no | yes |

## What it catches

A rule's paths, globs or applyTo match no file in the project.

A Claude Code rule with `paths`, a Cursor rule with `globs` or a Copilot instructions file with `applyTo` whose patterns match no file in the project. These files load only for matching files, so this one never loads. It usually happens after a folder is renamed. Only runs when the whole folder is linted, and only for patterns that name a folder. It stays quiet when the folder walk was cut short, when a pattern points into a folder AsItIs does not walk (such as `node_modules` or `dist`), and for extension-only patterns like `**/*.py`: a language pack with nothing to match is harmless. On a sparse checkout, files that are not checked out count as missing.

## Why it matters

Claude Code rules with paths, Cursor rules with globs and Copilot instructions with applyTo load only for matching files. When no file matches, usually after a folder was renamed, the rule never loads. Silent when the folder walk was cut short or a pattern points into a folder AsItIs does not walk.

## Bad example

```markdown
---
paths:
  - "src/legacy-api/**/*.ts"
---
# API rules
```
The API moved to `src/api/` last year. Nothing matches `src/legacy-api/`, so Claude never sees these rules.

## Good example

```markdown
---
paths:
  - "src/api/**/*.ts"
---
# API rules
```

## How to fix

Point the pattern at the files it is meant for, or delete the rule if the code is gone. A pattern with no slash, like `*.sql`, matches that file name in any folder; one with a slash is relative to the folder that holds `.claude` (Claude Code), `.cursor` (Cursor) or the workspace root (Copilot).

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line path-rule-matches-nothing -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file path-rule-matches-nothing -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "path-rule-matches-nothing": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/path-rule-matches-nothing.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
