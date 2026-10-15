## Catches
Two files that are loaded for the same agent in one session, or that mirror each other for different agents (CLAUDE.md and AGENTS.md, AGENTS.md and GEMINI.md), where one says "always X" and the other "never X" for the same action. Only runs when the whole folder is linted.

## Bad
```markdown
<!-- CLAUDE.md -->
- Always squash commits before merging.
```
```markdown
<!-- AGENTS.md -->
- Never squash commits; keep the full history.
```
A contributor using Claude Code squashes, one using Codex does not. Each agent did what its file said.

## Good
```markdown
<!-- CLAUDE.md -->
@AGENTS.md
```
```markdown
<!-- AGENTS.md -->
- Squash commits before merging.
```

## Fix
Keep one source of truth and import or link it from the other file. Where two files must differ on purpose (one agent has a tool the other lacks), say so in the line.
