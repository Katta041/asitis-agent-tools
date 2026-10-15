## Catches
A `SKILL.md` or a Claude Code subagent whose frontmatter has no `name`, or an empty one.

## Bad
```markdown
---
description: Generate a Storybook story for a React component. Use when asked for a story or a component demo.
---
```
Claude Code falls back to the folder name, so this still works there. Codex, Cursor, Copilot and Gemini CLI follow the Agent Skills spec, where `name` is required, and leave the skill out of their listings. The author tests in Claude Code, sees it work, and never learns that teammates on Cursor cannot use it.

## Good
```markdown
---
name: storybook-story
description: Generate a Storybook story for a React component. Use when asked for a story or a component demo.
---
```

## Fix
Add `name:` with the folder name: lowercase letters, digits and single hyphens, at most 64 characters. For a subagent, `name` is the handle Claude uses to delegate, so pick something a request would match (`test-writer`, not `agent1`).
