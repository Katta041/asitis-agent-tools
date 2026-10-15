# codex-chain-over-budget

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| budget | warning | several files or the folder layout | no | yes |

## What it catches

AGENTS.md files from the root down exceed Codex's 32 KiB.

Codex reads every `AGENTS.md` (or `AGENTS.override.md`) from the project root down to the folder it starts in, and stops at 32 KiB in total (`project_doc_max_bytes`). This rule adds the chain up for each folder that has one and says which file gets cut or dropped. Only runs when the whole folder is linted.

## Why it matters

The budget is shared root first; the file that crosses it is cut and deeper files are dropped. AsItIs adds up every AGENTS.md (or AGENTS.override.md) from the root down to each folder.

## Bad example

```text
AGENTS.md                 30 KB of shared rules
packages/api/AGENTS.md     6 KB of API rules
```
Started in `packages/api`, Codex reads the 30 KB root file and then only the first 2 KB or so of the API file. The rest of the API rules never reach it.

## Good example

```text
AGENTS.md                 8 KB: what every package needs
packages/api/AGENTS.md     6 KB of API rules
docs/agents/style.md       linked from AGENTS.md, read when needed
```

## How to fix

Shorten the files higher up the chain, since they count against every folder below. Move reference material into files the agent opens when it needs them. If the chain really needs to be longer, raise `project_doc_max_bytes` in `~/.codex/config.toml`, knowing every Codex session then spends that much context on it.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line codex-chain-over-budget -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file codex-chain-over-budget -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "codex-chain-over-budget": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Codex docs: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/codex-chain-over-budget.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
