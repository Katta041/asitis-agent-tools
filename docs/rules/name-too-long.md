# name-too-long

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | no | yes |

## What it catches

Skill name is longer than 64 characters.

A skill `name` over 64 characters. The Agent Skills spec sets the limit and validators reject longer names.

## Why it matters

The Agent Skills spec limits name to 64 characters; longer names are rejected.

## Bad example

```markdown
---
name: generate-release-notes-from-conventional-commits-and-merged-pull-requests
description: Draft release notes. Use when asked for a changelog or a release summary.
---
```
That name is 77 characters. `skills-ref validate` fails, and clients that enforce the spec will not load the skill.

## Good example

```markdown
---
name: release-notes
description: Draft release notes from conventional commits and merged pull requests. Use when asked for a changelog or a release summary.
---
```

## How to fix

Shorten the name to the two or three words a user would say, and rename the folder to match. Put the long form in `description`, where it helps the agent choose the skill.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line name-too-long -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file name-too-long -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "name-too-long": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Agent Skills specification](https://agentskills.io/specification), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/name-too-long.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
