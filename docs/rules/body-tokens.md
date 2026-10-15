# body-tokens

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| budget | warning, varies (see below) | one file | no | yes |

Severity: warning above about 6,000 tokens, a note from 5,000 to 6,000.

## What it catches

SKILL.md body is over about 5,000 tokens.

A `SKILL.md` whose body, after the frontmatter, is over about 5,000 tokens. The Agent Skills spec recommends staying under that and moving detail into files the skill references, which load only when needed. Token counts are local estimates, so a body of 5,000 to 6,000 tokens is a note and the warning starts above 6,000. When the file is also over 500 lines, this one finding gives both counts instead of a second [length](length.md) finding.

## Why it matters

The Agent Skills spec recommends a body under 5,000 tokens, with detail moved to files the skill links to. Token counts are estimates, so a body up to 6,000 is a note. A body over 500 lines is counted in the same finding.

## Bad example

```markdown
---
name: aws-cost-report
description: Build the monthly AWS cost report. Use when asked for cloud spend or a cost breakdown.
---

# AWS cost report

## Steps
...

## Appendix A: every Cost Explorer dimension and its filter syntax
...3,000 words...

## Appendix B: sample JSON responses
...2,500 words...
```
About 7,800 tokens enter the context every time the skill runs, most of it reference material the task rarely needs.

## Good example

```markdown
---
name: aws-cost-report
description: Build the monthly AWS cost report. Use when asked for cloud spend or a cost breakdown.
---

# AWS cost report

## Steps
...

Dimension and filter syntax: [references/dimensions.md](references/dimensions.md).
Sample responses: [references/samples.md](references/samples.md).
```

## How to fix

Keep the steps and the decisions in `SKILL.md`. Move tables, long examples and API detail into `references/` and link them with relative paths, one level deep.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line body-tokens -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file body-tokens -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "body-tokens": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Agent Skills specification](https://agentskills.io/specification), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/body-tokens.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
