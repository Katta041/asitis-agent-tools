# unknown-key

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | note | one file | no | yes |

## What it catches

A frontmatter key the reading tool ignores.

A frontmatter key that the tool reading the file does not know. When the key is one or two edits from a real one (`user-invokable` for `user-invocable`) it is a warning, because it is almost always a typo that silently turns the option off. Otherwise it is a note: the key is kept but does nothing.

## Why it matters

An ignored key does nothing. When it is one or two letters away from a real key it is reported as a warning, because it is almost always a typo.

## Bad example

```markdown
---
name: scaffold
description: Scaffold a new package in the monorepo. Use when asked to create a package or module.
user-invokable: false
allowed_tools: Bash(pnpm *)
---
```
Both keys are misspelled (`user-invocable`, `allowed-tools`), so the skill stays user-invocable and Claude still asks before every `pnpm` command. The message names the key it thinks you meant.

## Good example

```markdown
---
name: scaffold
description: Scaffold a new package in the monorepo. Use when asked to create a package or module.
user-invocable: false
allowed-tools: Bash(pnpm *)
---
```

## How to fix

Use the spelling from the message. Keys are case-sensitive and use hyphens in skills and commands (`allowed-tools`), camelCase in subagents (`permissionMode`) and Cursor rules (`alwaysApply`). A Claude Code rule in `.claude/rules/` reads `paths` only. For a key that is not a typo, either remove it or move it under `metadata`, which the spec reserves for extra data.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line unknown-key -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file unknown-key -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "unknown-key": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/unknown-key.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
