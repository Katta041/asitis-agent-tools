# missing-name

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | no | yes |

## What it catches

Required name field is missing.

A `SKILL.md` or a Claude Code subagent whose frontmatter has no `name`, or an empty one. SKILL.md files under tests, fixtures or testdata folders are test material and are not checked.

## Why it matters

The Agent Skills spec and Claude Code subagents require a name. Other agents skip a skill without one.

## Bad example

```markdown
---
description: Generate a Storybook story for a React component. Use when asked for a story or a component demo.
---
```
Claude Code falls back to the folder name, so this still works there. Codex, Cursor, Copilot and Gemini CLI follow the Agent Skills spec, where `name` is required, and leave the skill out of their listings. The author tests in Claude Code, sees it work, and never learns that teammates on Cursor cannot use it.

## Good example

```markdown
---
name: storybook-story
description: Generate a Storybook story for a React component. Use when asked for a story or a component demo.
---
```

## How to fix

Add `name:` with the folder name: lowercase letters, digits and single hyphens, at most 64 characters. For a subagent, `name` is the handle Claude uses to delegate, so pick something a request would match (`test-writer`, not `agent1`).

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line missing-name -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file missing-name -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "missing-name": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Agent Skills specification](https://agentskills.io/specification), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/missing-name.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
