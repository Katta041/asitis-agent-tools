## Catches
A Cursor `.mdc` rule with frontmatter that sets none of `alwaysApply: true`, `globs` or `description`. Cursor then includes the rule only when someone @-mentions it in chat.

## Bad
```markdown
---
description:
globs:
alwaysApply: false
---

Use the repository pattern for all database access.
```
This is the template Cursor creates for a new rule, saved without filling it in. The rule looks active in the rules list, but Cursor never loads it on its own.

## Good
```markdown
---
description: Database access conventions
globs: src/db/**/*.ts
alwaysApply: false
---

Use the repository pattern for all database access.
```

## Fix
Choose how the rule should load. `alwaysApply: true` puts it in every chat. `globs` attaches it when a matching file is in context. `description` lets the agent pull it in when the task matches. Leaving all three empty only makes sense for a rule you always @-mention by hand.
