# agents-md-unread-variant

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| drift | note | several files or the folder layout | no | yes |

## What it catches

AGENTS.override.md, AGENTS.local.md or .agents/*.md is read by some agents only, or by none.

An `AGENTS.override.md`, `AGENTS.local.md` or `.agents/*.md` file. Codex reads AGENTS.override.md in place of AGENTS.md; Claude Code never reads any of these. The note says which agents load the file, so nobody assumes it applies everywhere.

## Why it matters

Codex reads AGENTS.override.md in place of AGENTS.md; Claude Code never reads these variants, and neither reads AGENTS.local.md or .agents/*.md. The note says which agents load the file.

## Bad example

```text
AGENTS.md
AGENTS.override.md   # "Skip the integration tests this week"
```
Codex follows the override, Claude Code and Cursor follow AGENTS.md. The team sees different behaviour from different agents and does not know why.

## Good example

```text
AGENTS.md            # one file every agent reads
```

## How to fix

Keep instructions that apply to everyone in AGENTS.md. Use an override only as a short-lived local file, and delete it when the reason is gone. If a variant must stay, say in AGENTS.md which agents read it.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line agents-md-unread-variant -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file agents-md-unread-variant -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "agents-md-unread-variant": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Codex docs: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/agents-md-unread-variant.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
