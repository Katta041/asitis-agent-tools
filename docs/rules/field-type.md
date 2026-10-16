# field-type

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | review | yes |

## What it catches

A frontmatter field has the wrong type.

A frontmatter field whose value has the wrong shape for the tool that reads it: a boolean written as a quoted string, a list given as a number, `tools` given as a map, `paths` given as a map. The message names the field and the type it needs.

## Why it matters

A boolean given as a word the tool does not accept, or a list given as a number, is ignored or rejected by the tool that reads it.

## Bad example

```markdown
---
description: Project conventions
globs: src/**/*.ts
alwaysApply: "true"
---
```
In a Cursor `.mdc` rule, `alwaysApply` must be a YAML boolean. `"true"` in quotes is a string, which Cursor does not treat as true, so the rule only applies to files matching `globs`. In a skill, `disable-model-invocation: "nope"` and `allowed-tools: 3` are the same class of mistake.

## Good example

```markdown
---
description: Project conventions
globs: src/**/*.ts
alwaysApply: true
---
```

## How to fix

Booleans are unquoted `true` or `false` (Claude Code skills also accept `yes`, `no`, `on`, `off`, `1` and `0`). `allowed-tools`, `disallowed-tools`, `paths`, `globs` and subagent `tools` take a string or a list of strings. `description` is a string.

asitis can propose this edit. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule needs review before you apply it, because it changes or removes content.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line field-type -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file field-type -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "field-type": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/field-type.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
