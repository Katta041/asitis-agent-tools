## Catches
A file directly in `.claude/commands/` whose name matches a skill in the same `.claude/skills/`, by folder name or frontmatter `name`, ignoring case. Commands in subfolders (`/frontend:build`) cannot clash with a skill name. A plugin's `commands/` and `skills/` are not compared, because the Claude Code docs do not say which one wins there.

## Bad
```text
.claude/commands/run-app.md
.claude/skills/run-app/SKILL.md
```
Typing `/run-app` runs the skill. The command file is never used, and edits to it change nothing.

## Good
```text
.claude/skills/run-app/SKILL.md
```

## Fix
Delete the command if the skill replaced it (the usual case after moving commands to skills), or rename one of them.
