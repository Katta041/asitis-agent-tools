# frontmatter-not-mapping

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | no | yes |

## What it catches

Frontmatter is valid YAML but not a key: value mapping.

Frontmatter that parses as a list, a number or a plain string instead of `key: value` pairs. Every tool that reads frontmatter expects a mapping at the top level.

## Why it matters

Every tool expects a mapping. A list or a bare string gives no fields at all.

## Bad example

```markdown
---
- name: lint-fix
- description: Fix lint errors in changed files.
---
```
The leading `-` turns each line into a list item. The YAML is valid, but it is a list of two one-key maps, not a map with `name` and `description`, so the tool finds no fields at all.

## Good example

```markdown
---
name: lint-fix
description: Fix lint errors in changed files. Use after a lint failure or when asked to clean up warnings.
---
```

## How to fix

Remove the list markers so each field is `key: value` at the left margin. If the block holds a single word or sentence, it was probably meant to be the title; move it below the frontmatter and add real fields.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line frontmatter-not-mapping -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file frontmatter-not-mapping -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "frontmatter-not-mapping": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Agent Skills specification](https://agentskills.io/specification), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/frontmatter-not-mapping.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
