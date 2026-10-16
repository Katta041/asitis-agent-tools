# never-applied

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

Cursor rule has no alwaysApply, globs or description.

A Cursor `.mdc` rule with frontmatter that sets none of `alwaysApply: true`, `globs` or `description`. Cursor then includes the rule only when someone @-mentions it in chat.

## Why it matters

Cursor then applies the rule only when you @-mention it, which is rarely what the author meant.

## Bad example

```markdown
---
description:
globs:
alwaysApply: false
---

Use the repository pattern for all database access.
```
This is the template Cursor creates for a new rule, saved without filling it in. The rule looks active in the rules list, but Cursor never loads it on its own.

## Good example

```markdown
---
description: Database access conventions
globs: src/db/**/*.ts
alwaysApply: false
---

Use the repository pattern for all database access.
```

## How to fix

Choose how the rule should load. `alwaysApply: true` puts it in every chat. `globs` attaches it when a matching file is in context. `description` lets the agent pull it in when the task matches. Leaving all three empty only makes sense for a rule you always @-mention by hand.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line never-applied -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file never-applied -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "never-applied": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Cursor docs: Rules](https://cursor.com/docs/context/rules), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/never-applied.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
