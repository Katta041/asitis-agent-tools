# missing-frontmatter

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | no | yes |

## What it catches

A file that needs frontmatter has none.

A file that tools only use through its frontmatter and has none: a `SKILL.md`, a Claude Code subagent in `.claude/agents/`, a Cursor `.mdc` rule, or a memory topic file. The severity depends on what the file loses: error for skills and subagents, warning for Cursor rules (they still work when @-mentioned), note for memory topics.

## Why it matters

Skills and subagents need name and description to be listed; Cursor rules need it to know when to apply. Without it the file is skipped or only used when mentioned by hand.

## Bad example

```markdown
# Database migrations

When the user asks for a schema change:

1. Write the migration in `db/migrations/`.
2. Run `make migrate-dry-run` and show the plan.
```
Saved as `.claude/skills/db-migrate/SKILL.md`. Claude Code lists it under the folder name with "Database migrations" as its description, which is too little to pick it for a request like "add a column to users". Codex, Cursor, Copilot and Gemini CLI require `name` and `description` and skip the file.

## Good example

```markdown
---
name: db-migrate
description: Write and dry-run a database migration. Use when asked to add, rename or drop a column or table.
---

# Database migrations

When the user asks for a schema change:

1. Write the migration in `db/migrations/`.
2. Run `make migrate-dry-run` and show the plan.
```

## How to fix

Add a `---` block on line 1. Skills and subagents need `name` and `description`. A Cursor rule needs `alwaysApply: true`, `globs` or `description` to say when it applies. A memory topic file usually carries `name`, `description` and `type`.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line missing-frontmatter -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file missing-frontmatter -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "missing-frontmatter": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/missing-frontmatter.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
