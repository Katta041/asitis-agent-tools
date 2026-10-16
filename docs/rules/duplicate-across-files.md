# duplicate-across-files

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| budget | warning | several files or the folder layout | no | yes |

## What it catches

The same rule is in two files one tool loads every session.

The same line in two files that one tool loads together at the start of a session: CLAUDE.md and a `.claude/rules/` file without `paths`, CLAUDE.md and a file it imports with `@`, two Cursor rules with `alwaysApply: true`. Files for different tools (CLAUDE.md and AGENTS.md) are never compared, because no session loads both. Boilerplate that rule files repeat by design is not compared: a line that is only bold text (`**Impact: CRITICAL**`) unless it reads as an instruction, and a line that is only a link or a "Reference: [blog](...)" pointer. Only runs when the whole folder is linted.

## Why it matters

The tool loads both files, so the rule is paid for twice and the copies drift.

## Bad example

```markdown
<!-- CLAUDE.md -->
- Run `pnpm test` before every commit.
```
```markdown
<!-- .claude/rules/testing.md -->
- Run `pnpm test` before every commit.
```
Claude Code loads both files in every session, so the line is paid for twice, and the copies will drift the first time one is edited.

## Good example

```markdown
<!-- CLAUDE.md -->
See `.claude/rules/testing.md` for the test workflow.
```
```markdown
<!-- .claude/rules/testing.md -->
- Run `pnpm test` before every commit.
```

## How to fix

Keep the rule in one file. If a rule belongs with one area, put it in the `.claude/rules/` file for that area, with `paths` so it loads only when needed.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line duplicate-across-files -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file duplicate-across-files -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "duplicate-across-files": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/duplicate-across-files.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
