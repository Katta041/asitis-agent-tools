# xml-tag

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

Skill name or description contains an XML tag.

An XML or HTML tag such as `<important>` or `<br>` inside a skill `name` or `description`.

## Why it matters

The Claude API rejects XML tags in skill metadata, and an agent can read a tag in the listing as an instruction.

## Bad example

```markdown
---
name: deploy
description: <important>Always use this skill for deployments.</important> Deploys the current branch to staging.
---
```
Tags copied from prompt-writing advice do not belong in metadata. The Claude API rejects the upload, and in the skill listing an agent can read the tag as markup to obey rather than text to match.

## Good example

```markdown
---
name: deploy
description: Deploy the current branch to staging. Use when asked to deploy, ship or push to staging.
---
```

## How to fix

Remove the tags and say the same thing in plain words. Emphasis belongs in the skill body, not in the listing.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line xml-tag -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file xml-tag -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "xml-tag": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude API docs: Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/xml-tag.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
