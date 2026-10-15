# frontmatter-too-large

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | no | yes |

## What it catches

Frontmatter is too large to parse safely.

An opening `---` followed by more than 64 KB before any closing `---`. asitis does not parse a block that size, because hostile YAML can take a long time to read, and no real frontmatter comes close: `name`, `description` and a few options fit in a few hundred bytes.

## Why it matters

Frontmatter over 64 KB is not parsed, which protects against YAML that takes a long time to read. Real frontmatter is a few lines.

## Bad example

```markdown
---
name: brand-assets
description: Apply the brand kit. Use when producing slides or documents.
logo: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABLAAAASwCAYAAAAK...
---
```
A base64 image pasted into the frontmatter pushes it far past 64 KB. The other common cause is a missing closing `---` in a long file, which makes the "frontmatter" run to the end of the document.

## Good example

```markdown
---
name: brand-assets
description: Apply the brand kit. Use when producing slides or documents.
---

The logo is in [assets/logo.png](assets/logo.png).
```

## How to fix

Move bulk data into a file next to `SKILL.md` and link to it. If the block is large only because the closing `---` is missing, add it after the last field.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line frontmatter-too-large -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file frontmatter-too-large -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "frontmatter-too-large": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Agent Skills specification](https://agentskills.io/specification), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/frontmatter-too-large.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
