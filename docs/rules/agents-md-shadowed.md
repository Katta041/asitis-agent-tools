# agents-md-shadowed

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| drift | warning | several files or the folder layout | no | yes |

## What it catches

Claude Code reads CLAUDE.md here and skips AGENTS.md.

An `AGENTS.md` with a `CLAUDE.md` or `.claude/CLAUDE.md` in the same folder or a folder above it, where none of those files brings the AGENTS.md in (an `@` import up to four hops deep, a symlink, or an identical copy). Claude Code reads AGENTS.md only when no CLAUDE.md sits in the working directory or above it, so here it reads CLAUDE.md alone. When the only file in the way is a `CLAUDE.local.md`, the finding is `claude-local-hides-agents-md` instead. AGENTS.md files under template, example, fixture or temp folders, or inside a skill, are skipped. A CLAUDE.md beside it that is a near-copy of the AGENTS.md (more than 90% of their lines match) already gives Claude that content, so "import AGENTS.md" would load it twice; that pair is reported by [instruction-drift](instruction-drift.md) instead, with the advice to replace CLAUDE.md with `@AGENTS.md` or a symlink. Linting the AGENTS.md on its own is enough; the check looks at the folders around it.

## Why it matters

AGENTS.md is read by Claude Code only when no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md sits in the folder or above. Import it with @AGENTS.md or symlink one to the other.

## Bad example

```text
AGENTS.md     # the shared instructions, 180 lines, maintained by the team
CLAUDE.md     # "Prefer pnpm." (one line, added by one person)
```
Codex, Cursor and Copilot read AGENTS.md. Claude Code reads the one-line CLAUDE.md and never sees the 180 lines everyone else follows.

## Good example

```markdown
<!-- CLAUDE.md -->
@AGENTS.md

Prefer pnpm.
```

## How to fix

Put `@AGENTS.md` at the top of CLAUDE.md so Claude Code loads the shared file first, then the Claude-specific lines. Or make CLAUDE.md a symlink to AGENTS.md if there is nothing Claude-specific. Or delete CLAUDE.md, in which case Claude Code (2.1.277 and later) reads AGENTS.md on its own. If you only need it working on your machine, type `/config` in Claude Code and set Project instructions to `claude-md-and-agents-md`, which reads both. A sentence such as "read AGENTS.md" in CLAUDE.md does not count: it does not load the file.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line agents-md-shadowed -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file agents-md-shadowed -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "agents-md-shadowed": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/agents-md-shadowed.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
