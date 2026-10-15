## Catches
A file that tools only use through its frontmatter and has none: a `SKILL.md`, a Claude Code subagent in `.claude/agents/`, a Cursor `.mdc` rule, or a memory topic file. The severity depends on what the file loses: error for skills and subagents, warning for Cursor rules (they still work when @-mentioned), note for memory topics.

## Bad
```markdown
# Database migrations

When the user asks for a schema change:

1. Write the migration in `db/migrations/`.
2. Run `make migrate-dry-run` and show the plan.
```
Saved as `.claude/skills/db-migrate/SKILL.md`. Claude Code lists it under the folder name with "Database migrations" as its description, which is too little to pick it for a request like "add a column to users". Codex, Cursor, Copilot and Gemini CLI require `name` and `description` and skip the file.

## Good
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

## Fix
Add a `---` block on line 1. Skills and subagents need `name` and `description`. A Cursor rule needs `alwaysApply: true`, `globs` or `description` to say when it applies. A memory topic file usually carries `name`, `description` and `type`.
