# missing-applyTo

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

Copilot instructions file has neither applyTo nor description.

A Copilot `*.instructions.md` file with neither `applyTo` nor `description` in its frontmatter, or with no frontmatter at all.

## Why it matters

VS Code uses such a file only when you attach it by hand.

## Bad example

```markdown
# Testing conventions

- Use Vitest, not Jest.
- One `describe` per exported function.
```
Saved as `.github/instructions/testing.instructions.md`. VS Code only uses it when a person attaches it to a chat by hand, so the conventions are never applied automatically.

## Good example

```markdown
---
applyTo: "**/*.test.ts"
description: Testing conventions for the Vitest suites
---

# Testing conventions

- Use Vitest, not Jest.
- One `describe` per exported function.
```

## How to fix

Add `applyTo` with a glob relative to the workspace root (`**` for every file) so the instructions attach when matching files are edited, or `description` so the agent can pick the file up when the task matches. Both is best.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line missing-applyTo -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file missing-applyTo -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "missing-applyTo": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[VS Code docs: Custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/missing-applyTo.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
