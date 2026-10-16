# frontmatter-value-cut

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | review | yes |

## What it catches

An unquoted value is cut short at " #".

An unquoted value that contains a space followed by `#`. YAML reads everything from the ` #` on as a comment, so the stored value is shorter than what the author typed. The message shows the text that was dropped.

## Why it matters

In YAML an unquoted " #" starts a comment, so the rest of the value is silently dropped. Quote the value.

## Bad example

```markdown
---
name: triage
description: Triage a GitHub issue #123 style reference and label it. Use when given an issue number.
---
```
The description Claude Code reads is `Triage a GitHub issue`. The part that says when to use the skill is gone, and nothing warns the author.

## Good example

```markdown
---
name: triage
description: "Triage a GitHub issue #123 style reference and label it. Use when given an issue number."
---
```

## How to fix

Put the value in double quotes. The same applies to `argument-hint: [issue #]`, `globs` and any other field whose value contains ` #`.

asitis can propose this edit. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule needs review before you apply it, because it changes or removes content.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line frontmatter-value-cut -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file frontmatter-value-cut -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "frontmatter-value-cut": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[YAML 1.2.2 spec: Comments](https://yaml.org/spec/1.2.2/#comments), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/frontmatter-value-cut.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
