# name-format

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | review | yes |

## What it catches

Skill name is not lowercase letters, digits and single hyphens.

A skill `name` with uppercase letters, spaces, underscores, dots, or a hyphen at the start, end or doubled. The Agent Skills spec allows lowercase letters, digits and single hyphens. Lowercase letters outside ASCII (such as `é`) are a warning rather than an error: the spec accepts them, the Claude API and claude.ai do not. The message suggests a valid name when it can.

## Why it matters

The Claude API and claude.ai accept only a-z, 0-9 and hyphens. The Agent Skills spec also allows lowercase Unicode letters, which is reported as a warning.

## Bad example

```markdown
---
name: PDF_Processing
description: Extract text and tables from PDF files. Use when working with PDFs or forms.
---
```
`skills-ref validate` rejects this, and an upload to the Claude API or claude.ai fails. Claude Code loads it, so the author does not notice until the skill is shared.

## Good example

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files. Use when working with PDFs or forms.
---
```

## How to fix

Use the name from the message (`pdf-processing` for `PDF_Processing`) and rename the folder to match. Lowercase everything, replace spaces, underscores and dots with one hyphen, and trim hyphens from the ends.

asitis can propose this edit. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule needs review before you apply it, because it changes or removes content.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line name-format -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file name-format -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "name-format": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude API docs: Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/name-format.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
