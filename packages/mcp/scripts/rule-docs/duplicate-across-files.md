## Catches
The same line in two files that one tool loads together at the start of a session: CLAUDE.md and a `.claude/rules/` file without `paths`, CLAUDE.md and a file it imports with `@`, two Cursor rules with `alwaysApply: true`. Files for different tools (CLAUDE.md and AGENTS.md) are never compared, because no session loads both. Boilerplate that rule files repeat by design is not compared: a line that is only bold text (`**Impact: CRITICAL**`) unless it reads as an instruction, and a line that is only a link or a "Reference: [blog](...)" pointer. Only runs when the whole folder is linted.

## Bad
```markdown
<!-- CLAUDE.md -->
- Run `pnpm test` before every commit.
```
```markdown
<!-- .claude/rules/testing.md -->
- Run `pnpm test` before every commit.
```
Claude Code loads both files in every session, so the line is paid for twice, and the copies will drift the first time one is edited.

## Good
```markdown
<!-- CLAUDE.md -->
See `.claude/rules/testing.md` for the test workflow.
```
```markdown
<!-- .claude/rules/testing.md -->
- Run `pnpm test` before every commit.
```

## Fix
Keep the rule in one file. If a rule belongs with one area, put it in the `.claude/rules/` file for that area, with `paths` so it loads only when needed.
