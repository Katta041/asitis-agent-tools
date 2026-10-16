# frontmatter-yaml

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | no | yes |

## What it catches

Frontmatter is not valid YAML.

Frontmatter that the YAML parser rejects. The message quotes the parser's reason and the line. The usual causes are a colon inside an unquoted value, a tab used for indentation, an unquoted value that starts with `*`, `&`, `@` or `[`, and a stray quote.

## Why it matters

The tool that reads the file drops the frontmatter or the whole file, so its fields have no effect.

## Bad example

```markdown
---
name: pr-review
description: Review a pull request. Use when: the user pastes a PR link or asks for a review.
---
```
The second `:` in the description starts a nested mapping as far as YAML is concerned, so the parser stops with "Nested mappings are not allowed in compact mappings". Claude Code loads the skill with no description, and Codex and Cursor skip it.

## Good example

```markdown
---
name: pr-review
description: "Review a pull request. Use when: the user pastes a PR link or asks for a review."
---
```

## How to fix

Read the parser message in the finding; it names the line. Put values that contain `:`, `#`, quotes or a leading `*`, `&`, `@`, `[` or `{` in double quotes. Replace tabs with spaces. For a long description, use a block scalar:

```yaml
description: >-
  Review a pull request. Use when: the user pastes a PR link
  or asks for a review.
```

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line frontmatter-yaml -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file frontmatter-yaml -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "frontmatter-yaml": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Agent Skills specification](https://agentskills.io/specification), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/frontmatter-yaml.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
