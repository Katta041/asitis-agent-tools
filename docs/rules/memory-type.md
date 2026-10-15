# memory-type

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

Memory file type is not user, feedback, project or reference.

A memory topic file whose `type` is not one of the four values Claude Code records: `user`, `feedback`, `project` or `reference`.

## Why it matters

Claude Code memory files use one of four types; another value is not understood.

## Bad example

```markdown
---
name: Prefers pnpm
description: The user prefers pnpm over npm in every project
type: preference
---
```

## Good example

```markdown
---
name: Prefers pnpm
description: The user prefers pnpm over npm in every project
type: user
---
```

## How to fix

Pick the type that matches: `user` for who the person is and how they work, `feedback` for corrections and preferences about Claude's work, `project` for facts about the project that are not in the code, `reference` for pointers to external systems.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line memory-type -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file memory-type -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "memory-type": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/memory-type.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
