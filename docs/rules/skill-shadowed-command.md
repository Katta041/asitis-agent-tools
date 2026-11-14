# skill-shadowed-command

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | several files or the folder layout | no | yes |

## What it catches

A .claude/commands file has the same name as a skill, so the command never runs.

A file directly in `.claude/commands/` whose name matches a skill in the same `.claude/skills/`, by folder name or frontmatter `name`, ignoring case. Commands in subfolders (`/frontend:build`) cannot clash with a skill name. A plugin's `commands/` and `skills/` are not compared, because the Claude Code docs do not say which one wins there.

## Why it matters

When a skill and a file in .claude/commands/ share a name, Claude Code runs the skill. Names are compared ignoring case.

## Bad example

```text
.claude/commands/run-app.md
.claude/skills/run-app/SKILL.md
```
Typing `/run-app` runs the skill. The command file is never used, and edits to it change nothing.

## Good example

```text
.claude/skills/run-app/SKILL.md
```

## How to fix

Delete the command if the skill replaced it (the usual case after moving commands to skills), or rename one of them.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line skill-shadowed-command -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file skill-shadowed-command -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "skill-shadowed-command": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 15 November 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/skill-shadowed-command.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
