# name-reserved-word

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | note | one file | no | yes |

## What it catches

Skill name contains anthropic or claude.

A skill `name` that contains `anthropic` or `claude`, in any case. It is a note: only claude.ai and Claude API uploads reject the name; Claude Code and the other agents that read skills from disk accept it.

## Why it matters

The Claude API and claude.ai reject skills whose name contains a reserved word. Claude Code and other agents that read skills from disk accept them, so this is a note.

## Bad example

```markdown
---
name: claude-code-review
description: Review a pull request against the team checklist. Use when asked to review a PR.
---
```
Claude Code loads this. Uploading the same skill to the Claude API or adding it in claude.ai fails, because both reject names that contain a reserved word.

## Good example

```markdown
---
name: code-review
description: Review a pull request against the team checklist. Use when asked to review a PR.
---
```

## How to fix

Drop the vendor name. The skill already runs inside the product; the name should say what it does.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line name-reserved-word -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file name-reserved-word -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "name-reserved-word": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude API docs: Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/name-reserved-word.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
