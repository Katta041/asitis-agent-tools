# frontmatter-unclosed

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | no | yes |

## What it catches

Frontmatter opens with --- and never closes.

A file whose first line is `---` with no second `---` (or `...`) line after it, so the YAML block never ends.

## Why it matters

Without the closing --- the parser either rejects the file or swallows the body into the frontmatter.

## Bad example

```markdown
---
name: deploy
description: Deploy the current branch to staging. Use when asked to deploy or ship to staging.

# Deploy

1. Run `make build`.
```
The closing `---` was lost in an edit. From the parser's point of view the heading and the steps are part of the YAML, which fails to parse, so the skill has no name and no description.

## Good example

```markdown
---
name: deploy
description: Deploy the current branch to staging. Use when asked to deploy or ship to staging.
---

# Deploy

1. Run `make build`.
```

## How to fix

Add a line containing only `---` after the last frontmatter field. Check that nothing between the two fences is indented or wrapped in a way that YAML cannot read.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line frontmatter-unclosed -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file frontmatter-unclosed -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "frontmatter-unclosed": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/frontmatter-unclosed.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
