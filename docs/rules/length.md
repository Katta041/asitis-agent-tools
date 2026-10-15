# length

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| budget | warning | one file | no | yes |

## What it catches

File is longer than the vendor recommends or reads.

A steering file longer than the tool that reads it recommends or loads. The thresholds come from the vendor docs: CLAUDE.md over 200 lines, SKILL.md over 500 lines, a Cursor rule over 500 lines, AGENTS.md over 32 KiB (Codex's `project_doc_max_bytes`, shared by every AGENTS.md from the root down), a Windsurf rule over 12,000 characters, and MEMORY.md past 200 lines or 25 KB. The message says which limit applies and what the tool does past it.

## Why it matters

CLAUDE.md over 200 lines, SKILL.md over 500, MEMORY.md past 200 lines or 25 KB and AGENTS.md past 32 KiB are either followed less reliably or cut off by the tool.

## Bad example

```markdown
# CLAUDE.md

## Build and test
...

## Frontend conventions (src/web)
...120 lines about React, CSS modules and Storybook...

## Backend conventions (src/api)
...110 lines about handlers, migrations and OpenAPI...

## Infra (infra/)
...60 lines about Terraform modules...
```
340 lines, all loaded into every session, including the 120 lines about React when Claude is editing a Terraform module. Claude Code's docs say longer files reduce adherence, and the per-area sections are exactly what they suggest moving out.

## Good example

```markdown
# CLAUDE.md

## Build and test
...40 lines that apply everywhere...
```
```markdown
<!-- .claude/rules/frontend.md -->
---
paths:
  - src/web/**
---
# Frontend conventions
...
```
The root file is short, and the React rules load only when Claude works on a file under `src/web/`.

## How to fix

For CLAUDE.md, move the parts that matter for one area into `.claude/rules/<area>.md` with a `paths` list. Imports (`@docs/x.md`) organise text but do not reduce the cost, because imported files load too. For SKILL.md, move reference tables and long examples into files next to it and link them. For AGENTS.md, shorten it or link to docs: nested AGENTS.md files share the same 32 KiB budget and are dropped first. For MEMORY.md, keep one line per entry and move detail into topic files.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line length -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file length -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "length": "off" } }
```

`length` also takes thresholds, so a team that keeps a longer CLAUDE.md on purpose can raise the line:

```json
{ "rules": { "length": ["warning", { "claudeMdLines": 300 }] } }
```

The options are `claudeMdLines`, `skillMdLines`, `cursorRuleLines`, `codexBytes`, `windsurfChars` and `memoryIndexLines`.

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/length.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
