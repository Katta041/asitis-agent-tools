# claude-local-hides-agents-md

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| drift | warning | several files or the folder layout | no | yes |

## What it catches

A CLAUDE.local.md switches off the AGENTS.md fallback.

A folder with an `AGENTS.md`, no `CLAUDE.md`, and a `CLAUDE.local.md`. Claude Code counts CLAUDE.local.md as a CLAUDE.md for the "is there a CLAUDE.md" check, so AGENTS.md stops loading for the person who has the local file, and only for them. Only runs when the whole folder is linted.

## Why it matters

With only CLAUDE.local.md present, Claude Code stops reading AGENTS.md, so the shared instructions silently drop out (claude-code issue 96117).

## Bad example

```text
AGENTS.md          # shared instructions, committed
CLAUDE.local.md    # "Use the staging URL https://staging.example.invalid", gitignored
```
On this machine Claude Code reads only the one-line local file. Teammates without a local file get AGENTS.md. The difference is invisible in the repository.

## Good example

```markdown
<!-- CLAUDE.md, committed -->
@AGENTS.md
```
```markdown
<!-- CLAUDE.local.md, gitignored -->
Use the staging URL https://staging.example.invalid
```

## How to fix

Add a committed CLAUDE.md that imports AGENTS.md, so every CLAUDE.md-style load includes the shared file. Alternatively set Claude Code's project instructions setting to `claude-md-and-agents-md`, which reads both; that setting lives in user or managed settings, not in the repository.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line claude-local-hides-agents-md -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file claude-local-hides-agents-md -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "claude-local-hides-agents-md": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[claude-code issue 96117](https://github.com/anthropics/claude-code/issues/96117), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/claude-local-hides-agents-md.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
