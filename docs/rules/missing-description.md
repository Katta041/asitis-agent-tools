# missing-description

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | no | yes |

## What it catches

Required description field is missing.

A `SKILL.md` or subagent with no `description`, or an empty one. For a memory topic file this is a note, since Claude Code's own memory files carry a description but the docs do not require one.

## Why it matters

The description is what the agent reads to decide when to load a skill or delegate to a subagent.

## Bad example

```markdown
---
name: api-client
---

# API client

Regenerate the TypeScript client from `openapi.yaml`...
```
The description is the only text an agent sees before deciding to load a skill. Claude Code substitutes the first non-empty body line, here the heading "API client", which says nothing about when to use it. Other tools skip the skill.

## Good example

```markdown
---
name: api-client
description: Regenerate the TypeScript API client from openapi.yaml. Use after the OpenAPI spec changes or when the client is out of date.
---
```

## How to fix

Write one or two sentences: what the skill does, then when to use it, with the words a user would say. For a subagent, say what it is good at and when Claude should hand work to it.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line missing-description -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file missing-description -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "missing-description": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/missing-description.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
