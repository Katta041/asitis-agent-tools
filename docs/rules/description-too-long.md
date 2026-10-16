# description-too-long

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | no | yes |

## What it catches

Skill description is longer than 1,024 characters.

A skill `description` over 1,024 characters, the limit in the Agent Skills spec.

## Why it matters

The Agent Skills spec limits description to 1,024 characters.

## Bad example

```markdown
---
name: incident-report
description: Write an incident report. Start by collecting the timeline from the on-call channel, then list every alert that fired with its timestamp, then the customer impact in minutes and affected regions, then the root cause in the five-whys format we agreed in 2024, then the remediation items with owners and due dates, then... (1,400 characters)
---
```
The whole procedure was pasted into the description. Validators reject it, and every character of it sits in the skill listing of every session whether or not the skill is used.

## Good example

```markdown
---
name: incident-report
description: Write a post-incident report in the team template. Use after an incident is resolved or when asked for a postmortem.
---

# Incident report

1. Collect the timeline from the on-call channel.
2. List every alert with its timestamp.
...
```

## How to fix

Keep the description to what the skill does and when to use it, with the words a user would say. Move the steps into the body, which loads only when the skill runs.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line description-too-long -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file description-too-long -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "description-too-long": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Agent Skills specification](https://agentskills.io/specification), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/description-too-long.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
