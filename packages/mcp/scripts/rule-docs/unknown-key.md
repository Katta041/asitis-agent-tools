## Catches
A frontmatter key that the tool reading the file does not know. When the key is one or two edits from a real one (`user-invokable` for `user-invocable`) it is a warning, because it is almost always a typo that silently turns the option off. Otherwise it is a note: the key is kept but does nothing.

## Bad
```markdown
---
name: scaffold
description: Scaffold a new package in the monorepo. Use when asked to create a package or module.
user-invokable: false
allowed_tools: Bash(pnpm *)
---
```
Both keys are misspelled (`user-invocable`, `allowed-tools`), so the skill stays user-invocable and Claude still asks before every `pnpm` command. The message names the key it thinks you meant.

## Good
```markdown
---
name: scaffold
description: Scaffold a new package in the monorepo. Use when asked to create a package or module.
user-invocable: false
allowed-tools: Bash(pnpm *)
---
```

## Fix
Use the spelling from the message. Keys are case-sensitive and use hyphens in skills and commands (`allowed-tools`), camelCase in subagents (`permissionMode`) and Cursor rules (`alwaysApply`). A Claude Code rule in `.claude/rules/` reads `paths` only. For a key that is not a typo, either remove it or move it under `metadata`, which the spec reserves for extra data.
