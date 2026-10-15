# description-truncated

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| budget | warning | one file | no | yes |

## What it catches

description plus when_to_use is cut in the skill listing.

A skill whose `description` plus `when_to_use` is over 1,536 characters. Claude Code cuts the combined text at that length in the skill listing, so whatever comes after is never seen when Claude decides which skill to use.

## Why it matters

Claude Code cuts the combined text at 1,536 characters in the listing, so anything after that never helps the agent pick the skill.

## Bad example

```markdown
---
name: data-export
description: Export data from the warehouse to CSV, Parquet or Excel with the column mapping in docs/columns.md. Supports incremental exports by watermark column, full snapshots, partitioned output by date, ... (900 characters)
when_to_use: Use when the user asks for an export, a dump, a report file, a spreadsheet, a CSV, a Parquet file, ... (800 characters)
---
```
Everything past character 1,536 is cut, which here removes most of `when_to_use`, the part that tells Claude when to pick the skill.

## Good example

```markdown
---
name: data-export
description: Export warehouse data to CSV, Parquet or Excel. Use when asked for an export, a dump, a spreadsheet or a report file.
---
```

## How to fix

Put the key use case in the first sentence and cut the rest. Format options and edge cases belong in the body.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line description-truncated -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file description-truncated -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "description-truncated": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/description-truncated.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
