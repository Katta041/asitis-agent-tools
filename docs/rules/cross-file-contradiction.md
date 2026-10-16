# cross-file-contradiction

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| drift | warning | several files or the folder layout | no | yes |

## What it catches

Two files loaded for the same agent, or mirrored for different agents, contradict.

Two files that are loaded for the same agent in one session, or that mirror each other for different agents (CLAUDE.md and AGENTS.md, AGENTS.md and GEMINI.md), where one says "always X" and the other "never X" (or "do not X") for the same action, worded the same way. The files have to apply to the same folder, and both have to be in the same lint run: a whole-folder lint, or both passed as paths. A file that already says both sides on its own is left to the single-file contradiction rule.

## Why it matters

When CLAUDE.md says one thing and AGENTS.md or GEMINI.md the opposite, agents behave differently on the same repo.

## Bad example

```markdown
<!-- CLAUDE.md -->
- Always squash commits before merging.
```
```markdown
<!-- AGENTS.md -->
- Never squash commits before merging.
- Keep the full history.
```
A contributor using Claude Code squashes, one using Codex does not. Each agent did what its file said.

## Good example

```markdown
<!-- CLAUDE.md -->
@AGENTS.md
```
```markdown
<!-- AGENTS.md -->
- Squash commits before merging.
```

## How to fix

Keep one source of truth and import or link it from the other file. Where two files must differ on purpose (one agent has a tool the other lacks), say so in the line.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line cross-file-contradiction -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file cross-file-contradiction -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "cross-file-contradiction": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/cross-file-contradiction.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
