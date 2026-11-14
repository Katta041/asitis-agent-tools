# nested-contradiction

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| drift | note | several files or the folder layout | no | yes |

## What it catches

A subfolder instruction file says the opposite of the file above it.

A subfolder `CLAUDE.md`, `AGENTS.md` or `GEMINI.md` that says the opposite of the same kind of file in a folder above it ("use X" against "never use X"). The agent gets both when it works in the subfolder, the nested one last. That is often a deliberate exception, so this is a note, but a silent exception reads like a mistake to the agent and to the next person.

## Why it matters

The agent gets both files when it works in the subfolder, the nested one last. That is often an intended exception, so this is a note: say the exception out loud, or keep one rule.

## Bad example

```text
AGENTS.md                - Use npm for installs
packages/web/AGENTS.md   - Never use npm for installs
```

## Good example

```text
AGENTS.md                - Use npm for installs
packages/web/AGENTS.md   - This package is the exception: use pnpm here, not npm
```

## How to fix

If the exception is intended, say so in the subfolder file and name the rule it replaces. If it is not, keep one of the two.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line nested-contradiction -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file nested-contradiction -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "nested-contradiction": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Codex docs: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/nested-contradiction.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
