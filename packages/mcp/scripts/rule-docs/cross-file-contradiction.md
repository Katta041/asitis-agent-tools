## Catches
Two files that are loaded for the same agent in one session, or that mirror each other for different agents (CLAUDE.md and AGENTS.md, AGENTS.md and GEMINI.md), where one says "always X" and the other "never X" (or "do not X") for the same action, worded the same way. The files have to apply to the same folder, and both have to be in the same lint run: a whole-folder lint, or both passed as paths. A file that already says both sides on its own is left to the single-file contradiction rule.

## Bad
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
